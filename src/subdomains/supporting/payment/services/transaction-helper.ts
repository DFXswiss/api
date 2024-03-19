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
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { AmlRule } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';
import { FeeService, UserFeeRequest } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from '../../pricing/services/pricing.service';
import { InternalFeeDto } from '../dto/fee.dto';
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
    const { volume } = await this.getInSpecs(from, true);
    if (amount < volume.min * 0.5) return ValidationError.PAY_IN_TOO_SMALL;

    // check sellable
    if (!from.sellable) return ValidationError.PAY_IN_NOT_SELLABLE;

    return true;
  }

  async getInSpecs(from: Active, allowExpiredPrice: boolean): Promise<TxSpecExtended> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, from, TransactionDirection.IN);

    return this.convertToSource(
      undefined,
      from,
      { fee: { min: spec.minFee }, volume: { min: spec.minVolume } },
      allowExpiredPrice,
    );
  }

  async getOutSpecs(to: Active, allowExpiredPrice: boolean): Promise<TxSpecExtended> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, to, TransactionDirection.OUT);

    return this.convertToTarget(
      undefined,
      to,
      { fee: { min: spec.minFee }, volume: { min: spec.minVolume } },
      allowExpiredPrice,
    );
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
      [],
      false,
    );

    const { fee: txSpecReferenceSourceFee, volume: txSpecReferenceSourceVolume } = await this.convertToSource(
      inputReferenceAmount,
      fromReference,
      {
        fee: { min: specs.minFee, rate: fee.rate, fixed: fee.fixed, blockchain: fee.blockchain },
        volume: { min: specs.minVolume },
      },
      false,
    );

    const percentFeeAmount = inputReferenceAmount * fee.rate;
    const feeAmount = Math.max(
      percentFeeAmount + txSpecReferenceSourceFee.fixed + txSpecReferenceSourceFee.blockchain,
      txSpecReferenceSourceFee.min,
    );

    return {
      minVolume: txSpecReferenceSourceVolume.min,
      fee: {
        ...fee,
        ...txSpecReferenceSourceFee,
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
      discountCodes,
      allowExpiredPrice,
    );

    times.push(Date.now());

    const extendedSpecs: TxSpecExtended = {
      fee: { rate: fee.rate, blockchain: fee.blockchain, fixed: fee.fixed, min: specs.minFee },
      volume: {
        min: specs.minVolume,
        max: [paymentMethodIn, paymentMethodOut].includes(FiatPaymentMethod.CARD)
          ? Math.min(user?.userData.availableTradingLimit ?? Infinity, Config.tradingLimits.cardDefault)
          : user?.userData.availableTradingLimit ?? Config.tradingLimits.yearlyDefault,
      },
    };

    const { fee: txSpecSourceFee, volume: txSpecSourceVolume } = await this.convertToSource(
      sourceAmount,
      from,
      extendedSpecs,
      allowExpiredPrice,
    );
    const { fee: txSpecTargetFee, volume: txSpecTargetVolume } = await this.convertToTarget(
      targetAmount,
      to,
      extendedSpecs,
      allowExpiredPrice,
    );

    times.push(Date.now());

    // target estimation
    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      txSpecSourceFee.min,
      txSpecSourceFee.fixed,
      from,
      to,
      allowExpiredPrice,
    );

    times.push(Date.now());

    const txAmountChf = await this.getVolumeChfSince(
      target.sourceAmount,
      from,
      allowExpiredPrice,
      Util.daysBefore(1),
      user ? [user] : undefined,
    );

    times.push(Date.now());

    const error = this.getTxError(
      from,
      to,
      paymentMethodIn,
      target,
      txSpecSourceVolume.min,
      extendedSpecs.volume.max,
      txAmountChf,
      user,
    );

    const price = await this.pricingService.getPrice(from, to, allowExpiredPrice);

    if (Date.now() - times[0] > 300) {
      const timesString = times.map((t, i, a) => Util.round((t - (a[i - 1] ?? t)) / 1000, 3)).join(', ');
      this.logger.verbose(`${user ? 'Info' : 'Quote'} request times: ${timesString}`);
    }

    return {
      ...target,
      ...txSpecSourceFee,
      minFee: txSpecSourceFee.min,
      minFeeTarget: txSpecTargetFee.min,
      minVolume: txSpecSourceVolume.min,
      minVolumeTarget: txSpecTargetVolume.min,
      maxVolume: txSpecSourceVolume.max ?? undefined,
      maxVolumeTarget: txSpecTargetVolume.max ?? undefined,
      fee: { rate: fee.rate, blockchain: fee.blockchain, fixed: fee.fixed },
      feeSource: {
        rate: fee.rate,
        blockchain: txSpecSourceFee.blockchain,
        fixed: txSpecSourceFee.fixed,
        min: txSpecSourceFee.min,
        total: txSpecSourceFee.total ?? this.convert(txSpecTargetFee.total, price.invert(), isFiat(from)),
      },
      feeTarget: {
        rate: fee.rate,
        blockchain: txSpecTargetFee.blockchain,
        fixed: txSpecTargetFee.fixed,
        min: txSpecTargetFee.min,
        total: txSpecTargetFee.total ?? this.convert(txSpecSourceFee.total, price, isFiat(to)),
      },
      isValid: error == null,
      error,
    };
  }

  async getVolumeChfSince(
    inputAmount: number,
    from: Active,
    allowExpiredPrice: boolean,
    dateFrom: Date,
    users?: User[],
  ): Promise<number> {
    if (!users?.length) return inputAmount;

    const buyCryptoVolume = await this.buyCryptoService.getUserVolume(
      users.map((u) => u.id),
      dateFrom,
    );
    const buyFiatVolume = await this.buyFiatService.getUserVolume(
      users.map((u) => u.id),
      dateFrom,
    );

    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice);
    return price.convert(inputAmount) + buyCryptoVolume + buyFiatVolume;
  }

  private async getTxFee(
    user: User | undefined,
    paymentMethodIn: PaymentMethod,
    paymentMethodOut: PaymentMethod,
    from: Active,
    to: Active,
    txVolume: number,
    txAsset: Active,
    discountCodes: string[],
    allowExpiredPrice: boolean,
  ): Promise<InternalFeeDto> {
    const price = await this.pricingService.getPrice(txAsset, this.chf, true);

    const txVolumeInChf = price.convert(txVolume);

    const feeRequest: UserFeeRequest = {
      user,
      paymentMethodIn,
      paymentMethodOut,
      from,
      to,
      txVolume: txVolumeInChf,
      discountCodes,
      allowBlockchainFeeFallback: allowExpiredPrice,
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
      rate: targetAmount ? this.round(sourceAmount / targetAmount, isFiat(from)) : Number.MAX_VALUE,
      feeAmount: this.round(feeAmount, isFiat(from)),
      estimatedAmount: this.round(targetAmount, isFiat(to)),
      sourceAmount: this.round(sourceAmount, isFiat(from)),
      exactPrice: price.isValid,
    };
  }

  // --- HELPER METHODS --- //

  private async convertToSource(
    sourceAmount: number | undefined,
    from: Active,
    { fee, volume }: TxSpecExtended,
    allowExpiredPrice: boolean,
  ): Promise<TxSpecExtended> {
    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice).then((p) => p.invert());

    const maxVolumeSource = volume.max && (from.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99)); // -1% for the conversion

    const minFee = this.convert(fee.min, price, isFiat(from));
    const fixedFee = fee.fixed && this.convert(fee.fixed, price, isFiat(from));
    const blockchainFee = fee.blockchain && this.convert(fee.blockchain, price, isFiat(from));
    const totalFee = sourceAmount && Math.max(sourceAmount * fee.rate + fixedFee + blockchainFee, minFee);

    return {
      fee: {
        min: minFee,
        fixed: fixedFee,
        blockchain: blockchainFee,
        total: totalFee,
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(from)),
        max: maxVolumeSource && this.roundMaxAmount(maxVolumeSource, isFiat(from)),
      },
    };
  }

  private async convertToTarget(
    targetAmount: number | undefined,
    to: Active,
    { fee, volume }: TxSpecExtended,
    allowExpiredPrice: boolean,
  ): Promise<TxSpecExtended> {
    const price = await this.pricingService.getPrice(this.chf, to, allowExpiredPrice);

    const maxVolumeTarget = volume.max && (to.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99)); // -1% for the conversion

    const minFee = this.convert(fee.min, price, isFiat(to));
    const fixedFee = fee.fixed && this.convert(fee.fixed, price, isFiat(to));
    const blockchainFee = fee.blockchain && this.convert(fee.blockchain, price, isFiat(to));
    const totalFee = targetAmount && Math.max(targetAmount * fee.rate + fixedFee + blockchainFee, minFee);

    return {
      fee: {
        min: minFee,
        fixed: fixedFee,
        blockchain: blockchainFee,
        total: totalFee,
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(to)),
        max: maxVolumeTarget && this.roundMaxAmount(maxVolumeTarget, isFiat(to)),
      },
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

  private getTxError(
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    target: TargetEstimation,
    txSourceMinVolume: number,
    maxVolumeChf: number,
    txAmountChf: number,
    user?: User,
  ): TransactionError | undefined {
    // KYC checks
    if (isFiat(from)) {
      if (
        (user?.wallet.amlRule === AmlRule.RULE_2 && user?.userData.kycLevel < KycLevel.LEVEL_30) ||
        (user?.wallet.amlRule === AmlRule.RULE_3 && user?.userData.kycLevel < KycLevel.LEVEL_50)
      )
        return TransactionError.KYC_REQUIRED;
    }

    if (paymentMethodIn === FiatPaymentMethod.INSTANT && user && !user.userData.olkypayAllowed)
      return TransactionError.KYC_REQUIRED_INSTANT;
    if (
      isFiat(to) &&
      to.name !== 'CHF' &&
      user &&
      !user.userData.hasBankTxVerification &&
      txAmountChf > Config.tradingLimits.dailyDefault
    )
      return TransactionError.BANK_TRANSACTION_MISSING;

    // amount checks
    if (target.sourceAmount < txSourceMinVolume) return TransactionError.AMOUNT_TOO_LOW;
    if (txAmountChf > maxVolumeChf) return TransactionError.AMOUNT_TOO_HIGH;
  }
}
