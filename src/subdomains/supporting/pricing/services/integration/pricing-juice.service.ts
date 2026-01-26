import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JuiceService } from 'src/integration/blockchain/juice/juice.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingJuiceService extends PricingProvider implements OnModuleInit {
  private static readonly JUSD = 'JUSD';
  private static readonly JUICE = 'JUICE';
  private static readonly BTC = 'BTC';

  private static readonly ALLOWED_ASSETS = [
    PricingJuiceService.JUSD,
    PricingJuiceService.JUICE,
    PricingJuiceService.BTC,
  ];

  private static readonly CONTRACT_FEE = 0.01;

  private juiceService: JuiceService;
  private krakenService: KrakenService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  onModuleInit() {
    this.juiceService = this.moduleRef.get(JuiceService, { strict: false });
    this.krakenService = this.moduleRef.get(KrakenService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingJuiceService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingJuiceService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);
    if (from !== PricingJuiceService.JUICE && to !== PricingJuiceService.JUICE)
      throw new Error(`from asset ${from} to asset ${to} is not allowed`);

    // TODO: This calculation is only correct for purchases
    const contractPrice = (await this.juiceService.getJuicePrice()) * (1 + PricingJuiceService.CONTRACT_FEE);

    let totalPrice = contractPrice;

    if ([from, to].includes(PricingJuiceService.BTC)) {
      const usdPrice = await this.krakenService.getPrice('USD', PricingJuiceService.BTC);
      totalPrice = usdPrice.convert(contractPrice);
    }

    const assetPrice = from === PricingJuiceService.JUICE ? 1 / totalPrice : totalPrice;

    return Price.create(from, to, Util.round(assetPrice, 8));
  }
}
