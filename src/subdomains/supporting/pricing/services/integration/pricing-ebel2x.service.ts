import { Injectable } from '@nestjs/common';
import { Ebel2xService } from 'src/integration/blockchain/ebel2x/ebel2x.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingEbel2xService extends PricingProvider {
  private static readonly USDT = 'USDT';
  private static readonly MKX = 'MKX';
  private static readonly ALLOWED_ASSETS = [PricingEbel2xService.USDT, PricingEbel2xService.MKX];

  constructor(private readonly ebel2xService: Ebel2xService) {
    super();
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingEbel2xService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingEbel2xService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    const mkxPrice = await this.ebel2xService.getMKXPrice();

    if (from === PricingEbel2xService.USDT) {
      return Price.create(from, to, Util.round(mkxPrice, 8));
    }

    return Price.create(from, to, Util.round(1 / mkxPrice, 8));
  }
}
