import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RealUnitService } from 'src/integration/blockchain/realunit/realunit.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingRealUnitService extends PricingProvider implements OnModuleInit {
  private static readonly REALU = 'REALU';
  private static readonly ZCHF = 'ZCHF';

  private static readonly ALLOWED_ASSETS = [PricingRealUnitService.REALU, PricingRealUnitService.ZCHF];

  private realunitService: RealUnitService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  onModuleInit() {
    this.realunitService = this.moduleRef.get(RealUnitService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    const realunitPrice = await this.realunitService.getRealUnitPrice();

    const assetPrice = from === PricingRealUnitService.REALU ? realunitPrice : 1 / realunitPrice;

    return Price.create(from, to, Util.round(assetPrice, 8));
  }
}
