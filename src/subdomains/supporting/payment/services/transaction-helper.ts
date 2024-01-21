import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { FeeDirectionType, User } from 'src/subdomains/generic/user/models/user/user.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { FeeDto } from '../dto/fee.dto';
import { FiatPaymentMethod, PaymentMethod } from '../dto/payment-method.enum';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-details.dto';
import { TxFeeDetails } from '../dto/tx-fee-details.dto';
import { TxSpec, TxSpecExtended } from '../dto/tx-spec.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

export enum ValidationError {
  PAY_IN_TOO_SMALL = 'PayInTooSmall',
  PAY_IN_NOT_SELLABLE = 'PayInNotSellable',
}

export enum TransactionError {
  AMOUNT_TOO_LOW = 'AmountTooLow',
  AMOUNT_TOO_HIGH = 'AmountTooHigh',
}

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private eur: Fiat;
  private chf: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly transactionSpecificationRepo: TransactionSpecificationRepository,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.updateCache();
  }

  @Cron(CronExpression.EVERY_HOUR)
  @Lock()
  async updateCache() {
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(from: Asset | Fiat, amount: number): Promise<true | ValidationError> {
    // check min. volume
    const { minVolume } = await this.getInSpecs(from);
    if (amount < minVolume * 0.5) return ValidationError.PAY_IN_TOO_SMALL;

    // check sellable
    if (!from.sellable) return ValidationError.PAY_IN_NOT_SELLABLE;

    return true;
  }

  async getInSpecs(from: Asset | Fiat): Promise<TxSpec> {
    const { system, asset } = this.getProps(from);
    const spec = this.getSpec(system, asset, TransactionDirection.IN);

    return this.convertToSource(from, spec);
  }

  getSpecs(from: Asset | Fiat, to: Asset | Fiat): TxSpec {
    const { system: fromSystem, asset: fromAsset } = this.getProps(from);
    const { system: toSystem, asset: toAsset } = this.getProps(to);

    const { minFee, minDeposit } = this.getDefaultSpecs(fromSystem, fromAsset, toSystem, toAsset);

    return { minFee: minFee.amount, minVolume: minDeposit.amount };
  }

  getDefaultSpecs(
    fromSystem: string,
    fromAsset: string,
    toSystem: string,
    toAsset: string,
  ): { minFee: MinAmount; minDeposit: MinAmount } {
    const inSpec = this.getSpec(fromSystem, fromAsset, TransactionDirection.IN);
    const outSpec = this.getSpec(toSystem, toAsset, TransactionDirection.OUT);

    return {
      minFee: { amount: outSpec.minFee + inSpec.minFee, asset: 'EUR' },
      minDeposit: { amount: Math.max(outSpec.minVolume, inSpec.minVolume), asset: 'EUR' },
    };
  }

  private getSpec(system: string, asset: string, direction: TransactionDirection): TransactionSpecification {
    return (
      this.findSpec(system, asset, direction) ??
      this.findSpec(system, undefined, direction) ??
      this.findSpec(system, asset, undefined) ??
      this.findSpec(system, undefined, undefined) ??
      TransactionSpecification.default()
    );
  }

  private findSpec(
    system: string,
    asset: string | undefined,
    direction: TransactionDirection | undefined,
  ): TransactionSpecification | undefined {
    return this.transactionSpecifications.find(
      (t) => t.system == system && t.asset == asset && t.direction == direction,
    );
  }

  // --- TARGET ESTIMATION --- //
  async getTxFeeInfos(
    inputAmount: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
    referencePrice: Price,
    user: User,
    paymentMethod: PaymentMethod,
  ): Promise<TxFeeDetails> {
    // get fee
    const { direction, feeAsset } = this.getTxInfo(from, to);

    const fee = await this.getTxFee(user, direction, feeAsset, inputAmount, from, paymentMethod);

    // get specs
    const specs = this.getSpecs(from, to);
    const txSpecSource = await this.convertToSource(from, { ...specs, fixedFee: fee.fixed });

    const percentFeeAmount = inputAmount * fee.rate;
    const feeAmount = Math.max(percentFeeAmount + txSpecSource.fixedFee, txSpecSource.minFee);

    return {
      minVolume: this.convert(specs.minVolume, referencePrice, from instanceof Fiat),
      fee: {
        ...fee,
        fixed: this.convert(fee.fixed, referencePrice, from instanceof Fiat),
        min: this.convert(specs.minFee, referencePrice, from instanceof Fiat),
        total: this.convert(feeAmount, referencePrice, from instanceof Fiat),
      },
    };
  }

  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    from: Asset | Fiat,
    to: Asset | Fiat,
    paymentMethod: PaymentMethod,
    user?: User,
  ): Promise<TransactionDetails> {
    // get fee
    const { direction, feeAsset } = this.getTxInfo(from, to);

    const fee = await this.getTxFee(
      user,
      direction,
      feeAsset,
      targetAmount ? targetAmount : sourceAmount,
      targetAmount ? to : from,
      paymentMethod,
    );

    // get specs
    const specs = this.getSpecs(from, to);
    const extendedSpecs = {
      ...specs,
      maxVolume: user?.userData?.availableTradingLimit,
      fixedFee: fee.fixed,
    };

    const txSpecSource = await this.convertToSource(from, extendedSpecs);
    const txSpecTarget = await this.convertToTarget(to, extendedSpecs);

    // target estimation
    const target = await this.getTargetEstimation(
      sourceAmount,
      targetAmount,
      fee.rate,
      txSpecSource.minFee,
      txSpecSource.fixedFee,
      from,
      to,
    );
    const txAmount = await this.getDailyInputAmount(target.sourceAmount, from, user);

    const error =
      target.sourceAmount < txSpecSource.minVolume
        ? TransactionError.AMOUNT_TOO_LOW
        : txAmount > txSpecSource.maxVolume
        ? TransactionError.AMOUNT_TOO_HIGH
        : undefined;

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
    direction: FeeDirectionType,
    asset: Asset,
    txVolume: number,
    txAsset: Asset | Fiat,
    paymentMethod: PaymentMethod,
  ): Promise<FeeDto> {
    const price = await this.priceProviderService.getPrice(txAsset, this.eur);

    const txVolumeInEur = price.convert(txVolume);

    return paymentMethod === FiatPaymentMethod.CARD
      ? { fees: [], rate: Config.buy.fee.card, fixed: 0, payoutRefBonus: true }
      : user
      ? this.feeService.getUserFee({ user, direction, asset, txVolume: txVolumeInEur })
      : this.feeService.getDefaultFee({ direction, asset, txVolume: txVolumeInEur });
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    feeRate: number,
    minFeeSource: number,
    fixedFeeSource = 0,
    from: Asset | Fiat,
    to: Asset | Fiat,
  ): Promise<TargetEstimation> {
    const price = await this.priceProviderService.getPrice(from, to);

    const percentFeeAmount =
      outputAmount != null
        ? ((price.invert().convert(outputAmount) + fixedFeeSource) * feeRate) / (1 - feeRate)
        : inputAmount * feeRate;
    const feeAmount = Math.max(percentFeeAmount + fixedFeeSource, minFeeSource);

    const targetAmount = outputAmount != null ? outputAmount : price.convert(Math.max(inputAmount - feeAmount, 0));
    const sourceAmount = outputAmount != null ? price.invert().convert(outputAmount) + feeAmount : inputAmount;

    return {
      exchangeRate: this.round(price.price, from instanceof Fiat),
      rate: this.round(sourceAmount / targetAmount, from instanceof Fiat),
      feeAmount: this.round(feeAmount, from instanceof Fiat),
      estimatedAmount: this.round(targetAmount, to instanceof Fiat),
      sourceAmount: this.round(sourceAmount, from instanceof Fiat),
    };
  }

  // --- HELPER METHODS --- //
  private async getDailyInputAmount(inputAmount: number, from: Asset | Fiat, user?: User): Promise<number> {
    if (!user) return inputAmount;

    const buyCryptos = await this.buyCryptoService
      .getUserTransactions(user.id, Util.daysBefore(1))
      .then((buyCryptos) =>
        buyCryptos.filter(
          (b) => b.amlCheck === CheckStatus.PASS || b.amlCheck === CheckStatus.PENDING || b.amlCheck === null,
        ),
      );

    const buyFiats = await this.buyFiatService
      .getUserTransactions(user.id, Util.daysBefore(1))
      .then((buyCryptos) =>
        buyCryptos.filter(
          (b) => b.amlCheck === CheckStatus.PASS || b.amlCheck === CheckStatus.PENDING || b.amlCheck === null,
        ),
      );

    const price = await this.priceProviderService.getPrice(from, this.eur).then((p) => p.invert());
    const txEurAmount = Util.sumObjValue(buyCryptos, 'amountInEur') + Util.sumObjValue(buyFiats, 'amountInEur');

    return inputAmount + price.convert(txEurAmount);
  }

  private getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Fiat
      ? { system: 'Fiat', asset: param.name }
      : { system: param.blockchain, asset: param.dexName };
  }

  private async convertToSource(
    from: Asset | Fiat,
    { minFee, minVolume, maxVolume, fixedFee }: TxSpecExtended,
  ): Promise<TxSpecExtended> {
    const price = await this.priceProviderService.getPrice(from, this.eur).then((p) => p.invert());

    const maxVolumePrice =
      maxVolume && (await this.priceProviderService.getPrice(from, this.chf).then((p) => p.invert()));

    const maxVolumeSource = maxVolume && (from.name === 'CHF' ? maxVolume : maxVolumePrice.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, from instanceof Fiat),
      minVolume: this.convert(minVolume, price, from instanceof Fiat),
      maxVolume: maxVolumeSource && this.roundMaxAmount(maxVolumeSource, from instanceof Fiat),
      fixedFee: fixedFee && this.convert(fixedFee, price, from instanceof Fiat),
    };
  }

  private async convertToTarget(
    to: Asset | Fiat,
    { minFee, minVolume, maxVolume, fixedFee }: TxSpecExtended,
  ): Promise<TxSpecExtended> {
    const price = await this.priceProviderService.getPrice(this.eur, to);
    const maxVolumePrice = maxVolume && (await this.priceProviderService.getPrice(this.chf, to));

    const maxVolumeTarget = maxVolume && (to.name === 'CHF' ? maxVolume : maxVolumePrice.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, to instanceof Fiat),
      minVolume: this.convert(minVolume, price, to instanceof Fiat),
      maxVolume: maxVolumeTarget && this.roundMaxAmount(maxVolumeTarget, to instanceof Fiat),
      fixedFee: fixedFee && this.convert(fixedFee, price, to instanceof Fiat),
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

  private getTxInfo(from: Asset | Fiat, to: Asset | Fiat): { direction: FeeDirectionType; feeAsset: Asset } {
    if (from instanceof Fiat && to instanceof Asset) return { direction: FeeDirectionType.BUY, feeAsset: to };
    if (from instanceof Asset && to instanceof Fiat) return { direction: FeeDirectionType.SELL, feeAsset: from };
    return { direction: FeeDirectionType.CONVERT, feeAsset: to instanceof Asset ? to : undefined };
  }
}
