import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { TradingLimit } from 'src/subdomains/generic/user/models/user/dto/user.dto';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TargetEstimation, TransactionDetails } from '../entities/transaction-details';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TxSpec } from '../entities/tx-spec';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

export enum ValidationError {
  PAY_IN_TOO_SMALL = 'PayInTooSmall',
  PAY_IN_NOT_SELLABLE = 'PayInNotSellable',
}

export enum TransactionError {
  SOURCE_AMOUNT_TOO_LOW = 'SourceAmountTooLow',
  SOURCE_AMOUNT_TOO_HIGH = 'SourceAmountTooHigh',
}

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private eur: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly transactionSpecificationRepo: TransactionSpecificationRepository,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
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
  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    fee: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
    tradingLimit?: TradingLimit,
  ): Promise<TransactionDetails> {
    const specs = this.getSpecs(from, to);

    const { minVolume, minFee } = await this.convertToSource(from, specs);
    const { minVolume: minVolumeTarget, minFee: minFeeTarget } = await this.convertToTarget(to, specs);

    const target = await this.getTargetEstimation(sourceAmount, targetAmount, fee, minFee, from, to, tradingLimit);

    return {
      ...target,
      minFee,
      minVolume,
      minFeeTarget,
      minVolumeTarget,
      isValid: target.sourceAmount >= minVolume && target.sourceAmount <= target.tradingLimit,
      error:
        target.sourceAmount < minVolume
          ? TransactionError.SOURCE_AMOUNT_TOO_LOW
          : target.sourceAmount > target.tradingLimit
          ? TransactionError.SOURCE_AMOUNT_TOO_HIGH
          : undefined,
    };
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    fee: number,
    minFee: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
    tradingLimit: TradingLimit | undefined,
  ): Promise<TargetEstimation> {
    const price = await this.priceProviderService.getPrice(from, to);

    const fiatChf = from.name !== 'CHF' ? undefined : await this.fiatService.getFiatByName('CHF');
    const tradingLimitPrice = from.name !== 'CHF' ? undefined : await this.priceProviderService.getPrice(fiatChf, from);

    const percentFeeAmount =
      outputAmount != null ? price.invert().convert((outputAmount * fee) / (1 - fee)) : inputAmount * fee;
    const feeAmount = Math.max(percentFeeAmount, minFee);

    const targetAmount = outputAmount != null ? outputAmount : price.convert(Math.max(inputAmount - feeAmount, 0));
    const sourceAmount = outputAmount != null ? price.invert().convert(outputAmount) + feeAmount : inputAmount;

    const currentTradingLimit = tradingLimit ? tradingLimit.limit : Config.defaultDailyTradingLimit;
    const tradingLimitInSource = !tradingLimitPrice
      ? currentTradingLimit
      : tradingLimitPrice.convert(currentTradingLimit * 0.99, 0); // -1% for the conversion

    return {
      exchangeRate: this.round(price.price, from instanceof Fiat),
      feeAmount: this.round(feeAmount, from instanceof Fiat),
      estimatedAmount: this.round(targetAmount, to instanceof Fiat),
      sourceAmount: this.round(sourceAmount, from instanceof Fiat),
      tradingLimit: tradingLimitInSource,
    };
  }

  // --- HELPER METHODS --- //
  private getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Fiat
      ? { system: 'Fiat', asset: param.name }
      : { system: param.blockchain, asset: param.dexName };
  }

  private async convertToSource(from: Asset | Fiat, { minFee, minVolume }: TxSpec): Promise<TxSpec> {
    const price = await this.priceProviderService.getPrice(from, this.eur).then((p) => p.invert());

    return {
      minFee: this.convert(minFee, price, from instanceof Fiat),
      minVolume: this.convert(minVolume, price, from instanceof Fiat),
    };
  }

  private async convertToTarget(to: Asset | Fiat, { minFee, minVolume }: TxSpec): Promise<TxSpec> {
    const price = await this.priceProviderService.getPrice(this.eur, to);

    return {
      minFee: this.convert(minFee, price, to instanceof Fiat),
      minVolume: this.convert(minVolume, price, to instanceof Fiat),
    };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    const targetAmount = price.convert(amount);
    return this.round(targetAmount, isFiat);
  }

  private round(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, 2) : Util.roundByPrecision(amount, 5);
  }
}
