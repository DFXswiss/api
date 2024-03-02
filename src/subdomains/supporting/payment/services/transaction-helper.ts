import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Active, isFiat } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from '../../pricing/services/pricing.service';
import { FeeDto } from '../dto/fee.dto';
import { FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-details.dto';
import { TransactionError } from '../dto/transaction-error.enum';
import { TxFeeDetails } from '../dto/tx-fee-details.dto';
import { TxSpec, TxSpecExtended } from '../dto/tx-spec.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

export enum ValidationError {
  PAY_IN_TOO_SMALL = 'PayInTooSmall',
  PAY_IN_NOT_SELLABLE = 'PayInNotSellable',
}

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private readonly logger = new DfxLogger(TransactionHelper);

  private chf: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly specRepo: TransactionSpecificationRepository,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.updateCache();
  }

  @Cron(CronExpression.EVERY_HOUR)
  @Lock()
  async updateCache() {
    this.transactionSpecifications = await this.specRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(from: Active, amount: number): Promise<true | ValidationError> {
    // check min. volume
    const { minVolume } = await this.getInSpecs(from, true);
    if (amount < minVolume * 0.5) return ValidationError.PAY_IN_TOO_SMALL;

    // check sellable
    if (!from.sellable) return ValidationError.PAY_IN_NOT_SELLABLE;

    return true;
  }

  async getInSpecs(from: Active, allowExpiredPrice: boolean): Promise<TxSpec> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, from, TransactionDirection.IN);

    return this.convertToSource(from, spec, allowExpiredPrice);
  }

  async getOutSpecs(to: Active, allowExpiredPrice: boolean): Promise<TxSpec> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, to, TransactionDirection.OUT);

    return this.convertToTarget(to, spec, allowExpiredPrice);
  }

  getSpecs(from: Active, to: Active): TxSpec {
    const { system: fromSystem, asset: fromAsset } = this.specRepo.getProps(from);
    const { system: toSystem, asset: toAsset } = this.specRepo.getProps(to);

    const { minFee, minDeposit } = this.getDefaultSpecs(fromSystem, fromAsset, toSystem, toAsset);

    return { minFee: minFee.amount, minVolume: minDeposit.amount };
  }

  getDefaultSpecs(
    fromSystem: string,
    fromAsset: string,
    toSystem: string,
    toAsset: string,
  ): { minFee: MinAmount; minDeposit: MinAmount } {
    const inSpec = this.specRepo.getSpec(
      this.transactionSpecifications,
      fromSystem,
      fromAsset,
      TransactionDirection.IN,
    );
    const outSpec = this.specRepo.getSpec(this.transactionSpecifications, toSystem, toAsset, TransactionDirection.OUT);

    return {
      minFee: { amount: outSpec.minFee + inSpec.minFee, asset: 'CHF' },
      minDeposit: {
        amount: Math.max(outSpec.minVolume, inSpec.minVolume),
        asset: 'CHF',
      },
    };
  }

  // --- TARGET ESTIMATION --- //
  async getTxFeeInfos(
    inputReferenceAmount: number,
    from: Active,
    fromReference: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    user: User,
  ): Promise<TxFeeDetails> {
    // get fee
    const specs = this.getSpecs(from, to);
    const fee = await this.getTxFee(
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      inputReferenceAmount,
      fromReference,
      specs.minFee,
      [],
    );

    const txSpecReferenceSource = await this.convertToSource(
      fromReference,
      { ...specs, fixedFee: fee.fixed, minFee: fee.blockchain },
      false,
    );

    const percentFeeAmount = inputReferenceAmount * fee.rate;
    const feeAmount = Math.max(percentFeeAmount + txSpecReferenceSource.fixedFee, txSpecReferenceSource.minFee);

    return {
      minVolume: this.round(txSpecReferenceSource.minVolume, isFiat(from)),
      fee: {
        ...fee,
        fixed: this.round(txSpecReferenceSource.fixedFee, isFiat(from)),
        min: this.round(txSpecReferenceSource.minFee, isFiat(from)),
        total: this.round(feeAmount, isFiat(from)),
      },
    };
  }

  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    allowExpiredPrice: boolean,
    user?: User,
    discountCodes: string[] = [],
  ): Promise<TransactionDetails> {
    const times = [Date.now()];

    // get fee
    const specs = this.getSpecs(from, to);
    const fee = await this.getTxFee(
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      targetAmount ?? sourceAmount,
      targetAmount ? to : from,
      specs.minFee,
      discountCodes,
    );

    times.push(Date.now());

    const extendedSpecs = {
      ...specs,
      minFee: fee.blockchain,
      maxVolume: [paymentMethodIn, paymentMethodOut].includes(FiatPaymentMethod.CARD)
        ? Math.min(user?.userData.availableTradingLimit ?? Infinity, Config.defaultCardTradingLimit)
        : user?.userData.availableTradingLimit ?? Config.defaultTradingLimit,
      fixedFee: fee.fixed,
    };

    const txSpecSource = await this.convertToSource(from, extendedSpecs, allowExpiredPrice);
    const txSpecTarget = await this.convertToTarget(to, extendedSpecs, allowExpiredPrice);

    times.push(Date.now());

    // target estimation
    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      txSpecSource.minFee,
      txSpecSource.fixedFee,
      from,
      to,
      allowExpiredPrice,
    );

    times.push(Date.now());

    const txAmountChf = await this.getVolumeLast24hChf(target.sourceAmount, from, allowExpiredPrice, user);

    times.push(Date.now());

    const error =
      target.sourceAmount < txSpecSource.minVolume
        ? TransactionError.AMOUNT_TOO_LOW
        : txAmountChf > extendedSpecs.maxVolume
        ? TransactionError.AMOUNT_TOO_HIGH
        : isFiat(to) &&
          to.name !== 'CHF' &&
          user &&
          !user.userData.hasBankTxVerification &&
          txAmountChf > Config.defaultDailyTradingLimit
        ? TransactionError.BANK_TRANSACTION_MISSING
        : paymentMethodIn === FiatPaymentMethod.INSTANT && user && !user.userData.olkypayAllowed
        ? TransactionError.KYC_REQUIRED
        : undefined;

    if (Date.now() - times[0] > 300) {
      const timesString = times.map((t, i, a) => Util.round((t - (a[i - 1] ?? t)) / 1000, 3)).join(', ');
      this.logger.verbose(`${allowExpiredPrice ? 'Quote' : 'Info'} request times: ${timesString}`);
    }

    return {
      ...target,
      ...txSpecSource,
      maxVolume: txSpecSource.maxVolume ?? undefined,
      minFeeTarget: txSpecTarget.minFee,
      maxVolumeTarget: txSpecTarget.maxVolume ?? undefined,
      minVolumeTarget: txSpecTarget.minVolume,
      fee,
      isValid: error == null,
      error,
    };
  }

  private async getTxFee(
    user: User | undefined,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    from: Active,
    to: Active,
    txVolume: number,
    txAsset: Active,
    minFeeChf: number,
    discountCodes: string[],
  ): Promise<FeeDto> {
    const price = await this.pricingService.getPrice(txAsset, this.chf, true);

    const txVolumeInChf = price.convert(txVolume);

    const feeRequest = {
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      txVolume: txVolumeInChf,
      blockchainFee: minFeeChf,
      discountCodes,
    };

    return user ? this.feeService.getUserFee(feeRequest) : this.feeService.getDefaultFee(feeRequest);
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    feeRate: number,
    minFeeSource: number,
    fixedFeeSource = 0,
    from: Active,
    to: Active,
    allowExpiredPrice: boolean,
  ): Promise<TargetEstimation> {
    const price = await this.pricingService.getPrice(from, to, allowExpiredPrice);

    const percentFeeAmount =
      outputAmount != null
        ? ((price.invert().convert(outputAmount) + fixedFeeSource) * feeRate) / (1 - feeRate)
        : inputAmount * feeRate;
    const feeAmount = Math.max(percentFeeAmount + fixedFeeSource, minFeeSource);

    const targetAmount = outputAmount != null ? outputAmount : price.convert(Math.max(inputAmount - feeAmount, 0));
    const sourceAmount = outputAmount != null ? price.invert().convert(outputAmount) + feeAmount : inputAmount;

    return {
      exchangeRate: this.round(price.price, isFiat(from)),
      rate: this.round(sourceAmount / targetAmount, isFiat(from)),
      feeAmount: this.round(feeAmount, isFiat(from)),
      estimatedAmount: this.round(targetAmount, isFiat(to)),
      sourceAmount: this.round(sourceAmount, isFiat(from)),
      exactPrice: price.isValid,
    };
  }

  // --- HELPER METHODS --- //
  private async getVolumeLast24hChf(
    inputAmount: number,
    from: Active,
    allowExpiredPrice: boolean,
    user?: User,
  ): Promise<number> {
    if (!user) return inputAmount;

    const buyCryptoVolume = await this.buyCryptoService.getUserVolume([user.id], Util.daysBefore(1));
    const buyFiatVolume = await this.buyFiatService.getUserVolume([user.id], Util.daysBefore(1));

    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice);
    return (
      price.convert(inputAmount) +
      buyCryptoVolume.buy +
      buyCryptoVolume.checkout +
      buyCryptoVolume.convert +
      buyFiatVolume.sell
    );
  }

  private async convertToSource(
    from: Active,
    { minFee, minVolume, maxVolume, fixedFee }: TxSpecExtended,
    allowExpiredPrice: boolean,
  ): Promise<TxSpecExtended> {
    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice).then((p) => p.invert());

    const maxVolumeSource = maxVolume && (from.name === 'CHF' ? maxVolume : price.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, isFiat(from)),
      minVolume: this.convert(minVolume, price, isFiat(from)),
      maxVolume: maxVolumeSource && this.roundMaxAmount(maxVolumeSource, isFiat(from)),
      fixedFee: fixedFee && this.convert(fixedFee, price, isFiat(from)),
    };
  }

  private async convertToTarget(
    to: Active,
    { minFee, minVolume, maxVolume, fixedFee }: TxSpecExtended,
    allowExpiredPrice: boolean,
  ): Promise<TxSpecExtended> {
    const price = await this.pricingService.getPrice(this.chf, to, allowExpiredPrice);

    const maxVolumeTarget = maxVolume && (to.name === 'CHF' ? maxVolume : price.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, isFiat(to)),
      minVolume: this.convert(minVolume, price, isFiat(to)),
      maxVolume: maxVolumeTarget && this.roundMaxAmount(maxVolumeTarget, isFiat(to)),
      fixedFee: fixedFee && this.convert(fixedFee, price, isFiat(to)),
    };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    const targetAmount = price.convert(amount);
    return this.round(targetAmount, isFiat);
  }

  private round(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, 2) : Util.roundByPrecision(amount, 5);
  }

  private roundMaxAmount(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, -1) : Util.roundByPrecision(amount, 3);
  }
}
