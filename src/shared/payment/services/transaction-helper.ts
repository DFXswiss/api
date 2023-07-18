import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Active, isAsset, isFiat } from 'src/shared/models/active';
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
  async isValidInput(from: Active, amount: number): Promise<boolean> {
    // check sellable
    if (!from.sellable) return false;

    // check min. volume
    const { minVolume } = await this.getInSpecs(from);
    return amount > minVolume * 0.5;
  }

  async getInSpecs(from: Active): Promise<TxSpec> {
    const { system, asset } = this.getProps(from);
    const spec = this.getSpec(system, asset, TransactionDirection.IN);

    return this.convertToSource(from, spec);
  }

  getSpecs(from: Active, to: Active): TxSpec {
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
  async getTxDetails(amount: number, fee: number, from: Active, to: Active): Promise<TransactionDetails> {
    const specs = this.getSpecs(from, to);

    const { minVolume, minFee } = await this.convertToSource(from, specs);
    const { minVolume: minVolumeTarget, minFee: minFeeTarget } = await this.convertToTarget(to, specs);

    const target = await this.getTargetEstimation(amount, fee, minFee, from, to);

    return {
      ...target,
      minFee,
      minVolume,
      minFeeTarget,
      minVolumeTarget,
    };
  }

  private async getTargetEstimation(
    amount: number,
    fee: number,
    minFee: number,
    from: Active,
    to: Active,
  ): Promise<TargetEstimation> {
    const price = await this.priceProviderService.getPrice(from, to);
    const feeAmount = Math.max(amount * fee, minFee);
    const targetAmount = this.convert(Math.max(amount - feeAmount, 0), price, isFiat(to));

    return {
      exchangeRate: this.round(price.price, isFiat(from)),
      feeAmount: this.round(feeAmount, isFiat(from)),
      estimatedAmount: targetAmount,
    };
  }

  // --- HELPER METHODS --- //
  private getProps(param: Active): { system: string; asset: string } {
    return isAsset(param) ? { system: param.blockchain, asset: param.dexName } : { system: 'Fiat', asset: param.name };
  }

  private async convertToSource(from: Active, { minFee, minVolume }: TxSpec): Promise<TxSpec> {
    const price = await this.priceProviderService.getPrice(from, this.eur).then((p) => p.invert());

    return {
      minFee: this.convert(minFee, price, isFiat(from)),
      minVolume: this.convert(minVolume, price, isFiat(from)),
    };
  }

  private async convertToTarget(to: Active, { minFee, minVolume }: TxSpec): Promise<TxSpec> {
    const price = await this.priceProviderService.getPrice(this.eur, to);

    return {
      minFee: this.convert(minFee, price, isFiat(to)),
      minVolume: this.convert(minVolume, price, isFiat(to)),
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
