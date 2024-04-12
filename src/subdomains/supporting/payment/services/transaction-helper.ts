import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Active, isAsset, isFiat } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { AmlRule } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { FeeService, UserFeeRequest } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from '../../pricing/services/pricing.service';
import { InternalFeeDto } from '../dto/fee.dto';
import { FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { QuoteError } from '../dto/transaction-helper/quote-error.enum';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-helper/transaction-details.dto';
import { TxFeeDetails } from '../dto/transaction-helper/tx-fee-details.dto';
import { TxMinSpec, TxSpec } from '../dto/transaction-helper/tx-spec.dto';
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

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  async updateCache() {
    this.transactionSpecifications = await this.specRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(from: Active, amount: number): Promise<true | ValidationError> {
    // check min. volume
    const minVolume = await this.getMinVolumeIn(from, from, true);
    if (amount < minVolume * 0.5) return ValidationError.PAY_IN_TOO_SMALL;

    // check sellable
    if (!from.sellable) return ValidationError.PAY_IN_NOT_SELLABLE;

    return true;
  }

  async getMinVolumeIn(from: Active, fromReference: Active, allowExpiredPrice: boolean): Promise<number> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, from, TransactionDirection.IN);

    const price = await this.pricingService
      .getPrice(fromReference, this.chf, allowExpiredPrice)
      .then((p) => p.invert());
    return this.convert(spec.minVolume, price, isFiat(from));
  }

  async getMinVolumeOut(to: Active, toReference: Active, allowExpiredPrice: boolean): Promise<number> {
    const spec = this.specRepo.getSpecFor(this.transactionSpecifications, to, TransactionDirection.OUT);

    const price = await this.pricingService.getPrice(this.chf, toReference, allowExpiredPrice);
    return this.convert(spec.minVolume, price, isFiat(to));
  }

  async getBlockchainFee(asset: Active, allowExpiredPrice: boolean): Promise<number> {
    return this.feeService.getBlockchainFee(asset, allowExpiredPrice);
  }

  getMinSpecs(from: Active, to: Active): TxMinSpec {
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
    const minSpecs = this.getMinSpecs(from, to);
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

    const specs: TxSpec = {
      fee: { min: minSpecs.minFee, fixed: fee.fixed, network: fee.network },
      volume: { min: minSpecs.minVolume, max: Number.MAX_VALUE },
    };

    const sourceSpecs = await this.getSourceSpecs(fromReference, specs, false);

    const { dfx, total } = this.calculateTotalFee(inputReferenceAmount, fromReference, fee.rate, sourceSpecs);

    return {
      minVolume: sourceSpecs.volume.min,
      fee: {
        ...fee,
        ...sourceSpecs.fee,
        total,
        dfx,
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
    const specs = this.getMinSpecs(from, to);
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

    const defaultLimit = [paymentMethodIn, paymentMethodOut].includes(FiatPaymentMethod.CARD)
      ? Config.tradingLimits.cardDefault
      : Config.tradingLimits.yearlyDefault;

    const extendedSpecs: TxSpec = {
      fee: { network: fee.network, fixed: fee.fixed, min: specs.minFee },
      volume: {
        min: specs.minVolume,
        max: Math.min(user?.userData.availableTradingLimit ?? Number.MAX_VALUE, defaultLimit),
      },
    };

    const sourceSpecs = await this.getSourceSpecs(from, extendedSpecs, allowExpiredPrice);
    const targetSpecs = await this.getTargetSpecs(to, extendedSpecs, allowExpiredPrice);

    times.push(Date.now());

    // target estimation
    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      sourceSpecs,
      targetSpecs,
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
      target.sourceAmount,
      sourceSpecs.volume.min,
      extendedSpecs.volume.max,
      txAmountChf,
      user,
    );

    if (Date.now() - times[0] > 300) {
      const timesString = times.map((t, i, a) => Util.round((t - (a[i - 1] ?? t)) / 1000, 3)).join(', ');
      this.logger.verbose(`${user ? 'Info' : 'Quote'} request times: ${timesString}`);
    }

    return {
      ...target,
      minVolume: sourceSpecs.volume.min,
      minVolumeTarget: targetSpecs.volume.min,
      maxVolume: sourceSpecs.volume.max ?? undefined,
      maxVolumeTarget: targetSpecs.volume.max ?? undefined,
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
    sourceSpecs: TxSpec,
    targetSpecs: TxSpec,
    from: Active,
    to: Active,
    allowExpiredPrice: boolean,
  ): Promise<TargetEstimation> {
    const price = await this.pricingService.getPrice(from, to, allowExpiredPrice);
    const outputAmountSource = outputAmount && price.invert().convert(outputAmount);

    const sourceAmount = inputAmount ?? this.getInputAmount(outputAmountSource, feeRate, sourceSpecs);
    const sourceFees = this.calculateTotalFee(sourceAmount, from, feeRate, sourceSpecs);

    const targetAmount = outputAmount ?? price.convert(Math.max(inputAmount - sourceFees.total, 0));
    const targetFees = {
      dfx: this.convert(sourceFees.dfx, price, isFiat(to)),
      total: this.convert(sourceFees.total, price, isFiat(to)),
    };

    return {
      exchangeRate: Util.roundReadable(price.price, isFiat(from)),
      rate: targetAmount ? Util.roundReadable(sourceAmount / targetAmount, isFiat(from)) : Number.MAX_VALUE,
      sourceAmount: Util.roundReadable(sourceAmount, isFiat(from)),
      estimatedAmount: Util.roundReadable(targetAmount, isFiat(to)),
      exactPrice: price.isValid,
      feeSource: {
        rate: feeRate,
        ...sourceSpecs.fee,
        ...sourceFees,
      },
      feeTarget: {
        rate: feeRate,
        ...targetSpecs.fee,
        ...targetFees,
      },
    };
  }

  private getInputAmount(outputAmount: number, rate: number, { fee: { min, fixed, network } }: TxSpec): number {
    const inputAmountNormal = (outputAmount + fixed + network) / (1 - rate);
    const inputAmountWithMinFee = outputAmount + network + min;

    return Math.max(inputAmountNormal, inputAmountWithMinFee);
  }

  // --- HELPER METHODS --- //

  private async getSourceSpecs(from: Active, { fee, volume }: TxSpec, allowExpiredPrice: boolean): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(from, this.chf, allowExpiredPrice).then((p) => p.invert());

    return {
      fee: {
        min: this.convert(fee.min, price, isFiat(from)),
        fixed: this.convert(fee.fixed, price, isFiat(from)),
        network: this.convert(fee.network, price, isFiat(from)),
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(from)),
        max: this.roundMaxAmount(from.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(from)), // -1% for the conversion
      },
    };
  }

  private async getTargetSpecs(to: Active, { fee, volume }: TxSpec, allowExpiredPrice: boolean): Promise<TxSpec> {
    const price = await this.pricingService.getPrice(this.chf, to, allowExpiredPrice);

    return {
      fee: {
        min: this.convert(fee.min, price, isFiat(to)),
        fixed: this.convert(fee.fixed, price, isFiat(to)),
        network: this.convert(fee.network, price, isFiat(to)),
      },
      volume: {
        min: this.convert(volume.min, price, isFiat(to)),
        max: this.roundMaxAmount(to.name === 'CHF' ? volume.max : price.convert(volume.max * 0.99), isFiat(to)), // -1% for the conversion
      },
    };
  }

  private calculateTotalFee(
    amount: number,
    active: Active,
    rate: number,
    { fee: { fixed, min, network } }: TxSpec,
  ): { dfx: number; total: number } {
    const dfx = Math.max(amount * rate + fixed, min);
    const total = dfx + network;

    return { dfx: Util.roundReadable(dfx, isFiat(active)), total: Util.roundReadable(total, isFiat(active)) };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    const targetAmount = price.convert(amount);
    return Util.roundReadable(targetAmount, isFiat);
  }

  private roundMaxAmount(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, -1) : Util.roundByPrecision(amount, 3);
  }

  private getTxError(
    from: Active,
    to: Active,
    paymentMethodIn: PaymentMethod,
    sourceAmount: number,
    txSourceMinVolume: number,
    maxVolumeChf: number,
    txAmountChf: number,
    user?: User,
  ): QuoteError | undefined {
    // KYC checks
    if (isFiat(from)) {
      if (
        (user?.status === UserStatus.NA &&
          user?.wallet.amlRule === AmlRule.RULE_2 &&
          user?.userData.kycLevel < KycLevel.LEVEL_30) ||
        (user?.status === UserStatus.NA &&
          user?.wallet.amlRule === AmlRule.RULE_3 &&
          user?.userData.kycLevel < KycLevel.LEVEL_50)
      )
        return QuoteError.KYC_REQUIRED;
    }

    const isSwapTx = isAsset(from) && isAsset(to);

    if (isSwapTx && user?.userData.kycLevel < KycLevel.LEVEL_30 && user?.userData.status !== UserDataStatus.ACTIVE)
      return QuoteError.KYC_REQUIRED;

    if (paymentMethodIn === FiatPaymentMethod.INSTANT && user && !user.userData.olkypayAllowed)
      return QuoteError.KYC_REQUIRED_INSTANT;

    if (user && txAmountChf > user.userData.availableTradingLimit) return QuoteError.LIMIT_EXCEEDED;

    if (
      ((isFiat(to) && to.name !== 'CHF') || paymentMethodIn === FiatPaymentMethod.CARD || isSwapTx) &&
      user &&
      !user.userData.hasBankTxVerification &&
      txAmountChf > Config.tradingLimits.dailyDefault
    )
      return QuoteError.BANK_TRANSACTION_MISSING;

    // amount checks
    if (sourceAmount < txSourceMinVolume) return QuoteError.AMOUNT_TOO_LOW;
    if (txAmountChf > maxVolumeChf) return QuoteError.AMOUNT_TOO_HIGH;
  }
}
