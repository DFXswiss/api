import { Injectable } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/aml.service';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyFiatService: BuyFiatService,
    private readonly amlService: AmlService,
    private readonly userService: UserService,
    private readonly payInService: PayInService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const request = { inputAmount: Not(IsNull()), inputAsset: Not(IsNull()), isComplete: false };
    const entities = await this.buyFiatRepo.find({
      where: [
        {
          amlCheck: IsNull(),
          amlReason: IsNull(),
          ...request,
        },
        { amlCheck: CheckStatus.PENDING, amlReason: Not(AmlReason.MANUAL_CHECK), ...request },
      ],
      relations: {
        cryptoInput: true,
        sell: true,
        transaction: { user: { wallet: true, userData: { users: true } } },
        bankData: true,
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-fiat transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    for (const entity of entities) {
      try {
        if (!entity.cryptoInput.isConfirmed) continue;

        const amlCheckBefore = entity.amlCheck;

        const inputReferenceCurrency = entity.cryptoInput.asset;

        const minVolume = await this.transactionHelper.getMinVolumeIn(
          entity.cryptoInput.asset,
          entity.cryptoInput.asset,
          false,
        );

        const last24hVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(1, entity.transaction.created),
          Util.daysAfter(1, entity.transaction.created),
          entity.userData.users,
        );

        const last7dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(7, entity.transaction.created),
          Util.daysAfter(7, entity.transaction.created),
          entity.userData.users,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          entity.userData.users,
        );

        const last365dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          entity.userData.users,
        );

        const { bankData, blacklist } = await this.amlService.getAmlCheckInput(entity, last24hVolume);
        if (bankData && !bankData.comment) continue;

        await this.buyFiatRepo.update(
          ...entity.amlCheckAndFillUp(
            minVolume,
            last24hVolume,
            last7dVolume,
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
          ),
        );

        await this.payInService.updateAmlCheck(entity.cryptoInput.id, entity.amlCheck);

        if (amlCheckBefore !== entity.amlCheck) await this.buyFiatService.triggerWebhook(entity);

        if (entity.amlCheck === CheckStatus.PASS && entity.user.status === UserStatus.NA)
          await this.userService.activateUser(entity.user);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
      },
      relations: { sell: true, cryptoInput: true, transaction: { user: { wallet: true, userData: true } } },
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;

        const eurPrice = await this.pricingService.getPrice(inputCurrency, fiatEur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, fiatChf, false);

        const amountInChf = chfPrice.convert(entity.inputAmount, 2);

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          amountInChf,
          inputCurrency,
          inputCurrency,
          entity.sell.fiat,
          CryptoPaymentMethod.CRYPTO,
          FiatPaymentMethod.BANK,
          entity.user,
        );

        await this.buyFiatRepo.update(
          ...entity.setFeeAndFiatReference(
            eurPrice.convert(entity.inputAmount, 2),
            amountInChf,
            fee,
            eurPrice.convert(fee.min, 2),
            chfPrice.convert(fee.total, 2),
          ),
        );

        if (entity.amlCheck === CheckStatus.FAIL) return;

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInChf, feeId, entity.user.userData);
        }

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
        await this.buyFiatService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async setOutput(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputAmount: IsNull(),
        priceDefinitionAllowedDate: Not(IsNull()),
      },
      relations: { sell: true, cryptoInput: true },
    });

    for (const entity of entities) {
      try {
        const asset = entity.cryptoInput.asset;
        const currency = entity.sell.fiat;
        const price = await this.pricingService.getPrice(asset, currency, false);

        await this.buyFiatRepo.update(
          ...entity.setOutput(price.convert(entity.inputReferenceAmountMinusFee), currency, price.steps),
        );
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} output setting:`, e);
      }
    }
  }
}
