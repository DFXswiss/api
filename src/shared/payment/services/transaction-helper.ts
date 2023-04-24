import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';
import { Config, Process } from 'src/config/config';

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
  async updateCache() {
    if (Config.processDisabled(Process.TRANSACTION_SPECIFICATION)) return;
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async getSpecs(from: Asset | Fiat, to: Asset | Fiat): Promise<{ minFee: number; minVolume: number }> {
    const { system: fromSystem, asset: fromAsset } = this.getProps(from);
    const { system: toSystem, asset: toAsset } = this.getProps(to);
    const { minFee, minDeposit } = this.getDefaultSpecs(fromSystem, fromAsset, toSystem, toAsset);
    const price = await this.priceProviderService.getPrice(this.eur, from);

    return {
      minFee: this.convert(minFee.amount, price, from instanceof Fiat),
      minVolume: this.convert(minDeposit.amount, price, from instanceof Fiat),
    };
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
  async getTargetEstimation(
    amount: number,
    fee: number,
    minFee: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
  ): Promise<number> {
    const price = await this.priceProviderService.getPrice(from, to);
    const feeAmount = Math.max(amount * (fee / 100), minFee);
    return this.convert(Math.max(amount - feeAmount, 0), price, to instanceof Fiat);
  }

  // --- HELPER METHODS --- //
  private getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Fiat
      ? { system: 'Fiat', asset: param.name }
      : { system: param.blockchain, asset: param.dexName };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    return isFiat ? Util.round(amount / price.price, 2) : Util.roundByPrecision(amount / price.price, 5);
  }
}
