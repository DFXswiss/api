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

@Injectable()
export class TransactionSpecificationService implements OnModuleInit {
  constructor(
    private readonly transactionSpecificationRepo: TransactionSpecificationRepository,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
  ) {}
  private eur: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  onModuleInit() {
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
    void this.updateCache();
  }
  async get(from: Asset | Fiat, to: Asset | Fiat): Promise<{ minFee: MinAmount; minDeposit: MinAmount }> {
    const { system: fromSystem, asset: fromAsset } = this.getProps(from);
    const { system: toSystem, asset: toAsset } = this.getProps(to);

    const { minFee, minDeposit } = this.getDefault(fromSystem, fromAsset, toSystem, toAsset);
    const price = await this.priceProviderService.getPrice(this.eur, from);

    return {
      minFee: this.convert(minFee, price),
      minDeposit: this.convert(minDeposit, price),
    };
  }

  private convert(minAmount: MinAmount, price: Price): MinAmount {
    return { amount: Util.roundByPrecision(minAmount.amount / price.price, 3), asset: price.target };
  }

  private getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Asset
      ? { system: param.blockchain, asset: param.dexName }
      : { system: 'Fiat', asset: param.name };
  }

  getDefault(
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

  private getSpec(system: string, asset: string, direction: TransactionDirection) {
    return (
      this.findSpec(system, asset, direction) ??
      this.findSpec(system, undefined, direction) ??
      this.findSpec(system, asset, undefined) ??
      this.findSpec(system, undefined, undefined)
    );
  }

  private findSpec(system: string, asset: string | undefined, direction: TransactionDirection | undefined) {
    return this.transactionSpecifications.find(
      (t) => t.system == system && t.asset == asset && t.direction == direction,
    );
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateCache() {
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }
}
