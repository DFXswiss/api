import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { CountryService } from 'src/shared/models/country/country.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AmountType, Util } from 'src/shared/utils/util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { PayoutFrequency } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatNotificationService } from './buy-fiat-notification.service';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService implements OnModuleInit {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);
  private chf: Fiat;
  private eur: Fiat;

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyFiatService: BuyFiatService,
    private readonly amlService: AmlService,
    private readonly countryService: CountryService,
    private readonly buyFiatNotificationService: BuyFiatNotificationService,
    private readonly fiatOutputService: FiatOutputService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
  }

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
        transaction: { user: { wallet: true }, userData: { users: true } },
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
          false,
          isPayment,
        );

        const { bankData, blacklist } = await this.amlService.getAmlCheckInput(entity);
        if (bankData && !bankData.comment) continue;

        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, this.chf, false);
        const referenceEurPrice = await this.pricingService.getPrice(inputReferenceCurrency, this.eur, false);

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
        transaction: { user: { wallet: true }, userData: true },
      },
    });

    for (const entity of entities) {
      try {
        const isFirstRun = entity.percentFee == null;

        const inputCurrency = entity.cryptoInput.asset;

        const eurPrice = await this.pricingService.getPrice(inputCurrency, this.eur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, this.chf, false);

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
        cryptoInput: { paymentLinkPayment: { link: { route: { user: { userData: true } } } }, paymentQuote: true },
      },
    });

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;
        const outputCurrency = entity.outputAsset;
        const outputReferenceAmount = Util.roundReadable(entity.paymentLinkPayment.amount, AmountType.FIAT);

        if (outputCurrency.id !== entity.paymentLinkPayment.currency.id) throw new Error('Payment currency mismatch');

        // fees
        const feeRate = Config.payment.fee(entity.cryptoInput.paymentQuote.standard, outputCurrency, inputCurrency);
        const totalFee = entity.inputReferenceAmount * feeRate;
        const inputReferenceAmountMinusFee = entity.inputReferenceAmount - totalFee;

        const { fee: paymentLinkFee } = entity.cryptoInput.paymentLinkPayment.link.configObj;

        // prices
        const eurPrice = await this.pricingService.getPrice(inputCurrency, this.eur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, this.chf, false);

        const conversionPrice = Price.create(
          inputCurrency.name,
          outputCurrency.name,
          inputReferenceAmountMinusFee / outputReferenceAmount,
        );
        const priceStep = PriceStep.create(
          'Payment',
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
      relations: { sell: true, cryptoInput: true },
    });

    for (const entity of entities) {
      try {
        const asset = entity.cryptoInput.asset;
        const currency = entity.outputAsset;
        const price = !entity.outputReferenceAmount
          ? await this.pricingService.getPrice(asset, currency, false)
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
      relations: { fiatOutput: true },
    });

    for (const entity of entities) {
      try {
        await this.buyFiatRepo.update(
          ...entity.complete(entity.fiatOutput.remittanceInfo, entity.fiatOutput.outputDate, entity.bankTx),
        );
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} completion:`, e);
      }
    }
  }

  async addFiatOutputs(): Promise<void> {
    const buyFiatsWithoutOutput = await this.buyFiatRepo.find({
      relations: { fiatOutput: true, sell: true, transaction: { userData: true }, cryptoInput: true },
      where: {
        amlCheck: CheckStatus.PASS,
        fiatOutput: IsNull(),
        cryptoInput: { status: In([PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED]) },
      },
    });

    // immediate payouts
    const immediateOutputs = buyFiatsWithoutOutput.filter(
      (bf) =>
        !bf.userData.paymentLinksConfigObj.payoutFrequency ||
        bf.userData.paymentLinksConfigObj.payoutFrequency === PayoutFrequency.IMMEDIATE,
    );

    for (const buyFiat of immediateOutputs) {
      await this.fiatOutputService.createInternal('BuyFiat', { buyFiats: [buyFiat] });
    }

    // daily payouts
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const dailyOutputs = buyFiatsWithoutOutput.filter(
      (bf) => bf.userData.paymentLinksConfigObj.payoutFrequency === PayoutFrequency.DAILY && bf.created < startOfDay,
    );
    const sellGroups = Util.groupByAccessor(dailyOutputs, (bf) => bf.sell.id);

    for (const buyFiats of sellGroups.values()) {
      await this.fiatOutputService.createInternal(
        'BuyFiat',
        { buyFiats },
        buyFiats[0].userData.paymentLinksConfigObj.ep2ReportContainer != null,
      );
    }
  }
}
