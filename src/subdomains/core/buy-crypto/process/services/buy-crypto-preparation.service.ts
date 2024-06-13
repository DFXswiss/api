import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Transaction, TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { isFiat } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/aml.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
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
        if (entity.cryptoInput && (!entity.cryptoInput.isConfirmed || !entity.cryptoInput.amlCheck)) continue;

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputReferenceAssetChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const minVolume = await this.transactionHelper.getMinVolumeIn(inputCurrency, inputReferenceCurrency, false);

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

        await this.buyCryptoWebhookService.triggerWebhook(entity);

        if (entity.amlCheck === CheckStatus.PASS && entity.user.status === UserStatus.NA)
          await this.userService.activateUser(entity.user);

        // update sift transaction status
        if (entity.amlCheck === CheckStatus.FAIL)
          await this.siftService.transaction({
            $transaction_id: entity.id.toString(),
            $transaction_status: TransactionStatus.FAILURE,
            $time: entity.updated.getTime(),
          } as Transaction);
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
        const referenceOutputPrice =
          entity.target.asset.type !== AssetType.CUSTOM &&
          (await this.pricingService.getPrice(inputReferenceCurrency, entity.target.asset, false));

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);
        const networkFee =
          entity.target.asset.type !== AssetType.CUSTOM
            ? undefined
            : !fee.network
            ? referenceOutputPrice.convert(referenceChfPrice.invert().convert(Config.maxBlockchainFee))
            : referenceOutputPrice.convert(fee.network);

        entity.setFeeAndFiatReference(
          referenceEurPrice.convert(entity.inputReferenceAmount, 2),
          amountInChf,
          fee,
          isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
          referenceChfPrice.convert(fee.total, 2),
          networkFee,
        );

        await this.buyCryptoRepo.save(entity);

        if (entity.amlCheck === CheckStatus.FAIL) {
          // update sift transaction status
          await this.siftService.transaction({
            $transaction_id: entity.id.toString(),
            $transaction_status: TransactionStatus.FAILURE,
            $time: entity.updated.getTime(),
          } as Transaction);

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
}
