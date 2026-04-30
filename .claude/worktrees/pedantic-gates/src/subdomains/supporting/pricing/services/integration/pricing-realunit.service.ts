import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingRealUnitService extends PricingProvider implements OnModuleInit {
  private static readonly REALU = 'REALU';
  private static readonly ZCHF = 'ZCHF';
  private static readonly EUR = 'EUR';

  private static readonly ALLOWED_ASSETS = [
    PricingRealUnitService.REALU,
    PricingRealUnitService.ZCHF,
    PricingRealUnitService.EUR,
  ];

  private realunitService: RealUnitBlockchainService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  onModuleInit() {
    this.realunitService = this.moduleRef.get(RealUnitBlockchainService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);
    if (![from, to].includes(PricingRealUnitService.REALU))
      throw new Error(`from asset ${from} to asset ${to} is not allowed`);

    const isEurPair = [from, to].includes(PricingRealUnitService.EUR);

    const realunitPrice = isEurPair
      ? await this.realunitService.getRealUnitPriceEur()
      : await this.realunitService.getRealUnitPriceChf();

    if (realunitPrice == null) throw new Error(`No price available for ${from} -> ${to}`);

    const assetPrice = from === PricingRealUnitService.REALU ? 1 / realunitPrice : realunitPrice;

    return Price.create(from, to, Util.round(assetPrice, 8));
  }
}
