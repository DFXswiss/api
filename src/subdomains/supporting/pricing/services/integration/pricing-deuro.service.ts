import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingDeuroService extends PricingProvider implements OnModuleInit {
  private static readonly DEURO = 'dEURO';
  private static readonly NDEPS = 'nDEPS';
  private static readonly DEPS = 'DEPS';
  private static readonly USDT = 'USDT';

  private static readonly ALLOWED_ASSETS = [
    PricingDeuroService.DEURO,
    PricingDeuroService.NDEPS,
    PricingDeuroService.DEPS,
    PricingDeuroService.USDT,
  ];

  private static readonly CONTRACT_FEE = 0.02;

  private deuroService: DEuroService;
  private krakenService: KrakenService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async onModuleInit() {
    this.deuroService = this.moduleRef.get(DEuroService, { strict: false });
    this.krakenService = this.moduleRef.get(KrakenService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingDeuroService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingDeuroService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    // TODO: This calculation is only correct for purchases
    const contractPrice = (await this.deuroService.getDEPSPrice()) * (1 + PricingDeuroService.CONTRACT_FEE);

    let totalPrice = contractPrice;
    if ([from, to].includes(PricingDeuroService.USDT)) {
      const eurPrice = await this.krakenService.getPrice('EUR', PricingDeuroService.USDT);
      totalPrice = eurPrice.convert(contractPrice);
    }

    const assetPrice = [PricingDeuroService.DEPS, PricingDeuroService.NDEPS].includes(from)
      ? 1 / totalPrice
      : totalPrice;

    return Price.create(from, to, Util.round(assetPrice, 8));
  }
}
