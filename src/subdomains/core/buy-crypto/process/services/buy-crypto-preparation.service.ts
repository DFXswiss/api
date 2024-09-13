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
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
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
    private readonly userDataService: UserDataService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const request = { inputAmount: Not(IsNull()), inputAsset: Not(IsNull()), isComplete: false };
    const entities = await this.buyCryptoRepo.find({
      where: [
        {
          amlCheck: IsNull(),
          amlReason: IsNull(),
          ...request,
        },
        { amlCheck: CheckStatus.PENDING, amlReason: Not(AmlReason.MANUAL_CHECK), ...request },
      ],
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: true,
        cryptoRoute: true,
        transaction: { user: { wallet: true, userData: { users: true } } },
        bankData: true,
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    for (const entity of entities) {
      try {
        if (entity.cryptoInput && !entity.cryptoInput.isConfirmed) continue;

        const amlCheckBefore = entity.amlCheck;

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const isPayment = Boolean(entity.cryptoInput?.isPayment);
        const minVolume = await this.transactionHelper.getMinVolume(
          inputCurrency,
          entity.outputAsset,
          inputReferenceCurrency,
          false,
          isPayment,
        );

        const last24hVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(1, entity.transaction.created),
          Util.daysAfter(1, entity.transaction.created),
          entity.userData.users,
        );

        const last7dCheckoutVolume = await this.transactionHelper.getVolumeChfSince(
          entity.checkoutTx ? entity.inputReferenceAmount : 0,
          inputReferenceCurrency,
          false,
          Util.daysBefore(7, entity.transaction.created),
          Util.daysAfter(7, entity.transaction.created),
          entity.userData.users,
          'checkoutTx',
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

        const { bankData, blacklist, instantBanks } = await this.amlService.getAmlCheckInput(entity, last24hVolume);
        if (bankData && !bankData.comment) continue;

        const ibanCountry =
          entity.bankTx?.iban || entity.checkoutTx?.cardIssuerCountry
            ? await this.countryService.getCountryWithSymbol(
                entity.bankTx?.iban.substring(0, 2) ?? entity.checkoutTx.cardIssuerCountry,
              )
            : undefined;

        await this.buyCryptoRepo.update(
          ...entity.amlCheckAndFillUp(
            minVolume,
            last24hVolume,
            last7dCheckoutVolume,
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
            instantBanks,
            ibanCountry,
          ),
        );

        if (entity.cryptoInput) await this.payInService.updatePayInAction(entity.cryptoInput.id, entity.amlCheck);

        if (amlCheckBefore !== entity.amlCheck) {
          await this.buyCryptoWebhookService.triggerWebhook(entity);
          if (entity.amlReason === AmlReason.VIDEO_IDENT_NEEDED)
            await this.userDataService.triggerVideoIdent(entity.userData);
        }

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
        inputReferenceAmount: Not(IsNull()),
      },
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: true,
        cryptoRoute: true,
        transaction: { user: { userData: true, wallet: true } },
      },
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const isFirstRun = !entity.percentFee;

        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatEur, false);
        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, fiatChf, false);

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          amountInChf,
          inputCurrency,
          inputReferenceCurrency,
          entity.outputAsset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          entity.user,
        );

        const maxNetworkFee = fee.network ? fee.network : referenceChfPrice.invert().convert(Config.maxBlockchainFee);
        const maxNetworkFeeInOutAsset = await this.convertNetworkFee(
          inputReferenceCurrency,
          entity.outputAsset,
          maxNetworkFee,
        );
        const feeConstraints = entity.fee ?? (await this.buyCryptoRepo.saveFee(BuyCryptoFee.create(entity)));
        await this.buyCryptoRepo.updateFee(feeConstraints.id, { allowedTotalFeeAmount: maxNetworkFeeInOutAsset });

        await this.buyCryptoRepo.update(
          ...entity.setFeeAndFiatReference(
            referenceEurPrice.convert(entity.inputReferenceAmount, 2),
            amountInChf,
            fee,
            isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
            referenceChfPrice.convert(fee.total, 2),
          ),
        );

        if (entity.amlCheck === CheckStatus.FAIL) {
          // create sift transaction
          await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);
          return;
        }

        if (isFirstRun) {
          for (const feeId of fee.fees) {
            await this.feeService.increaseTxUsages(amountInChf, feeId, entity.user.userData);
          }

          await this.buyCryptoService.updateBuyVolume([entity.buy?.id]);
          await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute?.id]);
          await this.buyCryptoService.updateRefVolume([entity.usedRef]);
        }
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
