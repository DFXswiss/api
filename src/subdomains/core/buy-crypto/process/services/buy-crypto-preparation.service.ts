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
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CardBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PriceCurrency, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
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
    private readonly buyCryptoService: BuyCryptoService,
    private readonly amlService: AmlService,
    private readonly siftService: SiftService,
    private readonly countryService: CountryService,
    private readonly bankService: BankService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly bankTxService: BankTxService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const request: FindOptionsWhere<BuyCrypto> = {
      inputAmount: Not(IsNull()),
      inputAsset: Not(IsNull()),
      chargebackAllowedDateUser: IsNull(),
      isComplete: false,
    };
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
        cryptoInput: { asset: { balance: true, liquidityManagementRule: true } },
        buy: true,
        cryptoRoute: true,
        transaction: { user: { wallet: true }, userData: true },
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

        const { users, refUser, bankData, blacklist, banks } = await this.amlService.getAmlCheckInput(entity);
        if (bankData && bankData.status === ReviewStatus.INTERNAL_REVIEW) continue;

        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, PriceCurrency.CHF, false);
        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, PriceCurrency.EUR, false);

        const last7dCheckoutVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(7, entity.transaction.created),
          Util.daysAfter(7, entity.transaction.created),
          'checkoutTx',
          referenceChfPrice,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          undefined,
          referenceChfPrice,
        );

        const last365dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          undefined,
          referenceChfPrice,
        );

        const ibanCountry =
          entity.bankTx?.iban || entity.checkoutTx?.cardIssuerCountry
            ? await this.countryService.getCountryWithSymbol(
                entity.bankTx?.iban.substring(0, 2) ?? entity.checkoutTx.cardIssuerCountry,
              )
            : undefined;

        // check if amlCheck changed (e.g. reset or refund)
        if (
          entity.amlCheck === CheckStatus.PENDING &&
          (await this.buyCryptoRepo.existsBy({ id: entity.id, amlCheck: Not(CheckStatus.PENDING) }))
        )
          continue;

        await this.buyCryptoRepo.update(
          ...entity.amlCheckAndFillUp(
            inputCurrency,
            minVolume,
            referenceEurPrice.convert(entity.inputReferenceAmount, 2),
            referenceChfPrice.convert(entity.inputReferenceAmount, 2),
            last7dCheckoutVolume,
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
            banks,
            ibanCountry,
            refUser,
          ),
        );

        await this.amlService.postProcessing(entity, amlCheckBefore, last30dVolume);

        if (amlCheckBefore !== entity.amlCheck) await this.buyCryptoWebhookService.triggerWebhook(entity);

        if (entity.amlCheck === CheckStatus.PASS && amlCheckBefore === CheckStatus.PENDING)
          await this.buyCryptoNotificationService.paymentProcessing(entity);

        // create sift transaction
        if (entity.amlCheck === CheckStatus.FAIL)
          await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const request: FindOptionsWhere<BuyCrypto> = {
      amlCheck: CheckStatus.PASS,
      status: Not(
        In([
          BuyCryptoStatus.READY_FOR_PAYOUT,
          BuyCryptoStatus.PAYING_OUT,
          BuyCryptoStatus.COMPLETE,
          BuyCryptoStatus.STOPPED,
        ]),
      ),
      isComplete: false,
      inputReferenceAmount: Not(IsNull()),
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        {
          outputAsset: { type: Not(AssetType.PRESALE) },
          ...request,
        },
        { percentFee: IsNull(), ...request },
      ],
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: true,
        cryptoRoute: true,
        transaction: { user: { wallet: true, userData: true }, userData: true },
      },
    });

    for (const entity of entities) {
      try {
        const isFirstRun = entity.percentFee == null;

        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, PriceCurrency.EUR, false);
        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, PriceCurrency.CHF, false);

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);

        const bankIn = entity.bankTx
          ? await this.bankService.getBankByIban(entity.bankTx.accountIban).then((b) => b.name)
          : entity.checkoutTx
          ? CardBankName.CHECKOUT
          : undefined;

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          amountInChf,
          inputCurrency,
          inputReferenceCurrency,
          entity.outputAsset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          bankIn,
          undefined,
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
          await this.buyCryptoService.updateBuyVolume([entity.buy?.id]);
          await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute?.id]);
          await this.buyCryptoService.updateRefVolume([entity.usedRef]);
        }
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async chargebackTx(): Promise<void> {
    const baseRequest: FindOptionsWhere<BuyCrypto> = {
      chargebackAllowedDate: IsNull(),
      chargebackAllowedDateUser: Not(IsNull()),
      chargebackAmount: Not(IsNull()),
      isComplete: false,
      transaction: { userData: { kycStatus: In([KycStatus.NA, KycStatus.COMPLETED]) } },
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        { ...baseRequest, chargebackIban: Not(IsNull()) },
        { ...baseRequest, checkoutTx: { id: Not(IsNull()) } },
      ],
      relations: { checkoutTx: true, bankTx: true, cryptoInput: true, transaction: { userData: true } },
    });

    for (const entity of entities) {
      try {
        const chargebackAllowedDate = new Date();
        const chargebackAllowedBy = 'API';

        if (entity.bankTx) {
          await this.buyCryptoService.refundBankTx(entity, { chargebackAllowedDate, chargebackAllowedBy });
        } else if (entity.cryptoInput) {
          await this.buyCryptoService.refundCryptoInput(entity, { chargebackAllowedDate, chargebackAllowedBy });
        } else {
          await this.buyCryptoService.refundCheckoutTx(entity, { chargebackAllowedDate, chargebackAllowedBy });
        }
      } catch (e) {
        this.logger.error(`Failed to chargeback buy-crypto ${entity.id}:`, e);
      }
    }
  }

  async chargebackFillUp(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        chargebackBankTx: IsNull(),
        amlCheck: CheckStatus.FAIL,
        bankTx: { id: Not(IsNull()) },
        isComplete: false,
        chargebackRemittanceInfo: Not(IsNull()),
        chargebackOutput: { id: Not(IsNull()) },
      },
      relations: { transaction: { user: { userData: true } } },
    });

    for (const entity of entities) {
      try {
        const bankTx = await this.bankTxService.getBankTxByRemittanceInfo(entity.chargebackRemittanceInfo);
        if (!bankTx) continue;

        await this.bankTxService.updateInternal(bankTx, { type: BankTxType.BUY_CRYPTO_RETURN }, entity.user);
        await this.buyCryptoRepo.update(entity.id, { chargebackBankTx: bankTx, isComplete: true });
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} chargeback fillUp:`, e);
      }
    }
  }

  private async convertNetworkFee(from: Active, to: Active, fee: number): Promise<number> {
    if (isAsset(to) && [AssetType.CUSTOM, AssetType.PRESALE].includes(to.type)) return 0;

    const referenceOutputPrice = await this.pricingService.getPrice(from, to, false);

    return referenceOutputPrice.convert(fee);
  }
}
