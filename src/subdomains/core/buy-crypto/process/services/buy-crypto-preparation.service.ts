import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { Active, isAsset, isFiat } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/aml.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';
import { BuyCryptoService } from './buy-crypto.service';

@Injectable()
export class BuyCryptoPreparationService {
  private readonly logger = new DfxLogger(BuyCryptoPreparationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly amlService: AmlService,
    private readonly userService: UserService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly siftService: SiftService,
    private readonly countryService: CountryService,
    private readonly payInService: PayInService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: IsNull(),
        amlReason: IsNull(),
        inputAmount: Not(IsNull()),
        inputAsset: Not(IsNull()),
        isComplete: false,
      },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: { user: { wallet: true, userData: { users: true } } },
        cryptoRoute: { user: { wallet: true, userData: { users: true } } },
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    // CHF/EUR Price
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        if (entity.cryptoInput && !entity.cryptoInput.isConfirmed) continue;

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputReferenceAssetChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const minVolume = await this.transactionHelper.getMinVolumeIn(inputCurrency, inputReferenceCurrency, false);

        const { total: last24hVolume } = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(1, entity.transaction.created),
          Util.daysAfter(1, entity.transaction.created),
          entity.userData.users,
        );

        const { total: last7dVolume } = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(7, entity.transaction.created),
          Util.daysAfter(7, entity.transaction.created),
          entity.userData.users,
        );

        const { total: last30dVolume } = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          entity.userData.users,
        );

        const { total: last365dVolume } = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          entity.userData.users,
        );

        const { bankData, blacklist, instantBanks } = await this.amlService.getAmlCheckInput(entity);
        const ibanCountry = entity.bankTx?.iban
          ? await this.countryService.getCountryWithSymbol(entity.bankTx.iban.substring(0, 2))
          : undefined;

        await this.buyCryptoRepo.update(
          ...entity.amlCheckAndFillUp(
            inputReferenceAssetChfPrice,
            minVolume,
            last24hVolume,
            last7dVolume,
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
            instantBanks,
            ibanCountry,
          ),
        );

        if (entity.cryptoInput) await this.payInService.updateAmlCheck(entity.cryptoInput.id, entity.amlCheck);

        await this.buyCryptoWebhookService.triggerWebhook(entity);

        if (entity.amlCheck === CheckStatus.PASS && entity.user.status === UserStatus.NA)
          await this.userService.activateUser(entity.user);

        // create sift transaction
        if (entity.amlCheck === CheckStatus.FAIL)
          await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        status: Not(In([BuyCryptoStatus.READY_FOR_PAYOUT, BuyCryptoStatus.PAYING_OUT, BuyCryptoStatus.COMPLETE])),
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
      },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: { user: { userData: true, wallet: true } },
        cryptoRoute: { user: { userData: true, wallet: true } },
      },
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

        const { fee } = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          inputCurrency,
          inputReferenceCurrency,
          entity.target.asset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          entity.user,
        );

        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatEur, false);
        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);

        const maxNetworkFee = fee.network ? fee.network : referenceChfPrice.invert().convert(Config.maxBlockchainFee);
        const maxNetworkFeeInOutAsset = await this.convertNetworkFee(
          inputReferenceCurrency,
          entity.outputAsset,
          maxNetworkFee,
        );

        entity.setFeeAndFiatReference(
          referenceEurPrice.convert(entity.inputReferenceAmount, 2),
          amountInChf,
          fee,
          isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
          referenceChfPrice.convert(fee.total, 2),
          maxNetworkFeeInOutAsset,
        );

        await this.buyCryptoRepo.save(entity);

        if (entity.amlCheck === CheckStatus.FAIL) {
          // create sift transaction
          await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);
          return;
        }

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInChf, feeId, entity.user.userData);
        }

        await this.buyCryptoService.updateBuyVolume([entity.buy?.id]);
        await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute?.id]);
        await this.buyCryptoService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  private async convertNetworkFee(from: Active, to: Active, fee: number): Promise<number> {
    if (isAsset(to) && to.type === AssetType.CUSTOM) return 0;

    const referenceOutputPrice = await this.pricingService.getPrice(from, to, false);

    return referenceOutputPrice.convert(fee);
  }
}
