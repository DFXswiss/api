import { Injectable } from '@nestjs/common';
import { isBankHoliday } from 'src/config/bank-holiday.config';
import { Config } from 'src/config/config';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AmountType, Util } from 'src/shared/utils/util';
import { BlockAmlReasons } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { PayoutFrequency } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiat } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatNotificationService } from './buy-fiat-notification.service';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly feeService: FeeService,
    private readonly buyFiatService: BuyFiatService,
    private readonly amlService: AmlService,
    private readonly countryService: CountryService,
    private readonly buyFiatNotificationService: BuyFiatNotificationService,
    private readonly fiatOutputService: FiatOutputService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const request: FindOptionsWhere<BuyFiat> = {
      inputAmount: Not(IsNull()),
      inputAsset: Not(IsNull()),
      chargebackAllowedDateUser: IsNull(),
      isComplete: false,
      transaction: { userData: { riskStatus: Not(RiskStatus.SUSPICIOUS) } },
    };
    const entities = await this.buyFiatRepo.find({
      where: [
        {
          amlCheck: IsNull(),
          amlReason: IsNull(),
          ...request,
        },
        { amlCheck: CheckStatus.PENDING, amlReason: Not(In(BlockAmlReasons)), ...request },
      ],
      relations: {
        cryptoInput: { asset: { balance: true, liquidityManagementRule: true } },
        sell: true,
        transaction: { user: { wallet: true }, userData: true },
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

        const isPayment = entity.cryptoInput.isPayment;
        const minVolume = await this.transactionHelper.getMinVolume(
          entity.cryptoInput.asset,
          entity.outputAsset,
          entity.cryptoInput.asset,
          PriceValidity.VALID_ONLY,
          isPayment,
        );

        const { users, refUser, bankData, blacklist } = await this.amlService.getAmlCheckInput(entity);
        if (!users.length || (bankData && bankData.status === ReviewStatus.INTERNAL_REVIEW)) continue;

        const referenceChfPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.CHF,
          PriceValidity.VALID_ONLY,
        );
        const referenceEurPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.EUR,
          PriceValidity.VALID_ONLY,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          undefined,
          referenceChfPrice,
        );

        const last365dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          undefined,
          referenceChfPrice,
        );

        const ibanCountry = await this.countryService.getCountryWithSymbol(entity.sell.iban.substring(0, 2));

        // check if amlCheck changed (e.g. reset or refund)
        if (
          entity.amlCheck === CheckStatus.PENDING &&
          (await this.buyFiatRepo.existsBy({ id: entity.id, amlCheck: Not(CheckStatus.PENDING) }))
        )
          continue;

        await this.buyFiatRepo.update(
          ...entity.amlCheckAndFillUp(
            inputReferenceCurrency,
            minVolume,
            referenceEurPrice.convert(entity.inputReferenceAmount, 2),
            referenceChfPrice.convert(entity.inputReferenceAmount, 2),
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
            ibanCountry,
            refUser,
          ),
        );

        await this.amlService.postProcessing(entity, amlCheckBefore, last30dVolume);

        if (amlCheckBefore !== entity.amlCheck) await this.buyFiatService.triggerWebhook(entity);

        if (entity.amlCheck === CheckStatus.PASS && amlCheckBefore === CheckStatus.PENDING)
          await this.buyFiatNotificationService.paymentProcessing(entity);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const request = {
      amlCheck: CheckStatus.PASS,
      isComplete: false,
      inputReferenceAmount: Not(IsNull()),
    };
    const entities = await this.buyFiatRepo.find({
      where: [
        { ...request, percentFee: IsNull(), cryptoInput: { paymentLinkPayment: { id: IsNull() } } },
        { ...request, cryptoInput: { status: PayInStatus.ACKNOWLEDGED, paymentLinkPayment: { id: IsNull() } } },
      ],
      relations: {
        sell: true,
        cryptoInput: true,
        transaction: { user: { wallet: true, userData: true }, userData: true },
      },
    });

    for (const entity of entities) {
      try {
        const isFirstRun = entity.percentFee == null;

        const inputCurrency = entity.cryptoInput.asset;

        const eurPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.EUR, PriceValidity.VALID_ONLY);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.CHF, PriceValidity.VALID_ONLY);

        const amountInChf = chfPrice.convert(entity.inputAmount, 2);

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          amountInChf,
          inputCurrency,
          inputCurrency,
          entity.outputAsset,
          CryptoPaymentMethod.CRYPTO,
          FiatPaymentMethod.BANK,
          undefined,
          IbanBankName.MAERKI,
          entity.user,
        );

        await this.buyFiatRepo.update(
          ...entity.setFeeAndFiatReference(fee, eurPrice.convert(fee.min, 2), chfPrice.convert(fee.total, 2)),
        );

        if (entity.amlCheck === CheckStatus.FAIL) return;

        if (isFirstRun) {
          await this.buyFiatService.updateSellVolume([entity.sell?.id]);
          await this.buyFiatService.updateRefVolume([entity.usedRef]);
        }
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async fillPaymentLinkPayments(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
        cryptoInput: { paymentLinkPayment: { id: Not(IsNull()) }, status: PayInStatus.COMPLETED },
      },
      relations: {
        sell: true,
        cryptoInput: {
          paymentLinkPayment: { link: { route: { user: { userData: { organization: true } } } } },
          paymentQuote: true,
        },
      },
    });

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;
        const outputCurrency = entity.outputAsset;
        const outputReferenceAmount = Util.roundReadable(entity.paymentLinkPayment.amount, AmountType.FIAT);

        if (outputCurrency.id !== entity.paymentLinkPayment.currency.id) throw new Error('Payment currency mismatch');

        // fees
        const feeRate = Config.payment.forexFee(
          entity.cryptoInput.paymentQuote.standard,
          outputCurrency,
          inputCurrency,
        );
        const totalFee = entity.inputReferenceAmount * feeRate;
        const inputReferenceAmountMinusFee = entity.inputReferenceAmount - totalFee;

        const { fee: paymentLinkFee } = entity.cryptoInput.paymentLinkPayment.link.configObj;

        // prices
        const eurPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.EUR, PriceValidity.VALID_ONLY);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.CHF, PriceValidity.VALID_ONLY);

        const conversionPrice = Price.create(
          inputCurrency.name,
          outputCurrency.name,
          inputReferenceAmountMinusFee / outputReferenceAmount,
        );
        const priceStep = PriceStep.create(
          Config.priceSourcePayment,
          conversionPrice.source,
          conversionPrice.target,
          conversionPrice.price,
        );

        await this.buyFiatRepo.update(
          ...entity.setPaymentLinkPayment(
            eurPrice.convert(entity.inputAmount, 2),
            chfPrice.convert(entity.inputAmount, 2),
            feeRate,
            totalFee,
            chfPrice.convert(totalFee, 5),
            inputReferenceAmountMinusFee,
            outputReferenceAmount,
            paymentLinkFee,
            [priceStep],
          ),
        );

        if (entity.amlCheck === CheckStatus.FAIL) return;

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fill paymentLinkPayments:`, e);
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
      relations: { sell: true, cryptoInput: true, transaction: { userData: true } },
    });

    for (const entity of entities) {
      try {
        const asset = entity.cryptoInput.asset;
        const currency = entity.outputAsset;
        const price = !entity.outputReferenceAmount
          ? await this.pricingService.getPrice(asset, currency, PriceValidity.VALID_ONLY)
          : undefined;
        const priceSteps = price?.steps ?? [
          PriceStep.create(
            'DFX',
            entity.inputReferenceAsset,
            entity.outputReferenceAsset.name,
            entity.inputReferenceAmountMinusFee / entity.outputReferenceAmount,
          ),
        ];

        await this.buyFiatRepo.update(
          ...entity.setOutput(
            entity.outputReferenceAmount ?? price.convert(entity.inputReferenceAmountMinusFee),
            priceSteps,
          ),
        );

        for (const feeId of entity.usedFees.split(';')) {
          await this.feeService.increaseTxUsages(entity.amountInChf, Number.parseInt(feeId), entity.userData);
        }
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} output setting:`, e);
      }
    }
  }

  async complete(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        isComplete: false,
        fiatOutput: {
          remittanceInfo: Not(IsNull()),
          outputDate: Not(IsNull()),
          bankTx: { id: Not(IsNull()) },
        },
      },
      relations: {
        fiatOutput: { bankTx: true },
        transaction: { userData: true, user: { wallet: true } },
        cryptoInput: true,
        sell: true,
      },
    });

    for (const entity of entities) {
      try {
        await this.buyFiatRepo.update(
          ...entity.complete(entity.fiatOutput.remittanceInfo, entity.fiatOutput.outputDate, entity.fiatOutput.bankTx),
        );

        // send webhook
        await this.buyFiatService.triggerWebhook(entity);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} completion:`, e);
      }
    }
  }

  async addFiatOutputs(): Promise<void> {
    const buyFiatsWithoutOutput = await this.buyFiatRepo.find({
      relations: {
        fiatOutput: true,
        sell: true,
        transaction: { userData: true },
        cryptoInput: { paymentLinkPayment: { link: true } },
      },
      where: {
        amlCheck: CheckStatus.PASS,
        fiatOutput: IsNull(),
        cryptoInput: { status: In([PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED]) },
      },
    });

    const buyFiatsToPayout = buyFiatsWithoutOutput
      .filter((bf) => !bf.userData.paymentLinksConfigObj.requiresConfirmation || bf.paymentLinkPayment?.isConfirmed)
      .filter(
        (bf) =>
          !bf.userData.paymentLinksConfigObj.requiresExplicitPayoutRoute ||
          bf.paymentLinkPayment?.link.linkConfigObj.payoutRouteId != null,
      );

    // immediate payouts
    const immediateOutputs = buyFiatsToPayout.filter(
      (bf) =>
        !bf.userData.paymentLinksConfigObj.payoutFrequency ||
        bf.userData.paymentLinksConfigObj.payoutFrequency === PayoutFrequency.IMMEDIATE,
    );

    for (const buyFiat of immediateOutputs) {
      await this.fiatOutputService.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [buyFiat] }, buyFiat.id);
    }

    // batched payouts (business days only)
    if (!isBankHoliday()) {
      // daily
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      await this.processBatchedPayout(buyFiatsToPayout, PayoutFrequency.DAILY, startOfDay);

      // weekly
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);

      await this.processBatchedPayout(buyFiatsToPayout, PayoutFrequency.WEEKLY, startOfWeek);
    }
  }

  private async processBatchedPayout(buyFiats: BuyFiat[], frequency: PayoutFrequency, cutoffDate: Date): Promise<void> {
    const outputs = buyFiats.filter(
      (bf) => bf.userData.paymentLinksConfigObj.payoutFrequency === frequency && bf.created < cutoffDate,
    );
    const sellGroups = Util.groupByAccessor(
      outputs,
      (bf) => `${bf.sell.id}-${bf.paymentLinkPayment?.link.linkConfigObj.payoutRouteId ?? 0}`,
    );

    for (const buyFiats of sellGroups.values()) {
      await this.fiatOutputService.createInternal(
        FiatOutputType.BUY_FIAT,
        { buyFiats },
        buyFiats[0].id,
        buyFiats[0].userData.paymentLinksConfigObj.ep2ReportContainer != null,
      );
    }
  }

  async chargebackTx(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        chargebackAllowedDate: IsNull(),
        chargebackAllowedDateUser: Not(IsNull()),
        chargebackAmount: Not(IsNull()),
        isComplete: false,
        transaction: {
          userData: {
            kycStatus: In([KycStatus.NA, KycStatus.COMPLETED]),
            status: Not(UserDataStatus.BLOCKED),
            riskStatus: In([RiskStatus.NA, RiskStatus.RELEASED]),
          },
          user: { status: In([UserStatus.NA, UserStatus.ACTIVE]) },
        },
        chargebackAddress: Not(IsNull()),
      },
      relations: { cryptoInput: true, transaction: { userData: true } },
    });

    for (const entity of entities) {
      try {
        await this.buyFiatService.refundBuyFiatInternal(entity, {
          chargebackAllowedDate: new Date(),
          chargebackAllowedBy: 'API',
        });
      } catch (e) {
        this.logger.error(`Failed to chargeback buy-fiat ${entity.id}:`, e);
      }
    }
  }
}
