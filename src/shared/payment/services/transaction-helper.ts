import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TargetEstimation, TransactionDetails } from '../entities/transaction-details';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TxSpec } from '../entities/tx-spec';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

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
  async isValidInput(from: Asset | Fiat, amount: number): Promise<boolean> {
    // check sellable
    if (!from.sellable) return false;

    // check min. volume
    const { minVolume } = await this.getInSpecs(from);
    return amount > minVolume * 0.5;
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
  ): Promise<TransactionDetails> {
    const specs = this.getSpecs(from, to);

    const { minVolume, minFee } = await this.convertToSource(from, specs);
    const { minVolume: minVolumeTarget, minFee: minFeeTarget } = await this.convertToTarget(to, specs);

    const target = await this.getTargetEstimation(sourceAmount, targetAmount, fee, minFee, from, to);

    return {
      ...target,
      minFee,
      minVolume,
      minFeeTarget,
      minVolumeTarget,
    };
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    fee: number,
    minFee: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
  ): Promise<TargetEstimation> {
    const price = await this.priceProviderService.getPrice(from, to);
    const feeAmount = Math.max(
      inputAmount != null
        ? inputAmount * fee
        : this.convert((outputAmount * fee) / (1 - fee), price.invert(), from instanceof Fiat),
      minFee,
    );
    const targetAmount =
      inputAmount != null
        ? this.convert(Math.max(inputAmount - feeAmount, 0), price, to instanceof Fiat)
        : this.round(outputAmount, to instanceof Fiat);
    const sourceAmount =
      inputAmount != null
        ? this.round(inputAmount, from instanceof Fiat)
        : this.convert(outputAmount, price.invert(), from instanceof Fiat) + feeAmount;

    return {
      exchangeRate: this.round(price.price, from instanceof Fiat),
      feeAmount: this.round(feeAmount, from instanceof Fiat),
      estimatedAmount: targetAmount,
      sourceAmount,
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
