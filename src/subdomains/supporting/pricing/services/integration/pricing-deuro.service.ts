import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingDeuroService extends PricingProvider implements OnModuleInit {
  private static readonly DEURO = 'dEURO';
  private static readonly NDEPS = 'nDEPS';
  private static readonly DEPS = 'DEPS';

  private static readonly ALLOWED_ASSETS = [
    PricingDeuroService.DEURO,
    PricingDeuroService.NDEPS,
    PricingDeuroService.DEPS,
  ];

  private static readonly CONTRACT_FEE = 0;

  private deuroService: DEuroService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async onModuleInit() {
    this.deuroService = this.moduleRef.get(DEuroService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingDeuroService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingDeuroService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    const contractPrice = await this.deuroService.getDEPSPrice();
    const assetPrice = from === PricingDeuroService.DEURO ? contractPrice : 1 / contractPrice;

    return Price.create(from, to, Util.round(assetPrice / (1 - PricingDeuroService.CONTRACT_FEE), 8));
  }
}
