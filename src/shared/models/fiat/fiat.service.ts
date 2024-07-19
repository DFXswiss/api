import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
  private ipCountryToCurrency: { [key: string]: string } = {
    DE: 'EUR',
    AT: 'EUR',
    CH: 'CHF',
    LI: 'CHF',
    IT: 'EUR',
    FR: 'EUR',
  };

  constructor(private fiatRepo: FiatRepository) {}

  async getAllFiat(): Promise<Fiat[]> {
    return this.fiatRepo.findCached('all');
  }

  async getActiveFiat(): Promise<Fiat[]> {
    return this.fiatRepo.findCachedBy('active', [
      { buyable: true },
      { sellable: true },
      { cardBuyable: true },
      { cardSellable: true },
      { instantBuyable: true },
      { instantSellable: true },
    ]);
  }

  async getFiat(id: number): Promise<Fiat> {
    return this.fiatRepo.findOneCachedBy(id, { id });
  }

  async getFiatByName(name: string): Promise<Fiat> {
    return this.fiatRepo.findOneCachedBy(name, { name });
  }

  async updatePrice(fiatId: number, chfPrice: number) {
    await this.fiatRepo.update(fiatId, { approxPriceChf: chfPrice });
    this.fiatRepo.invalidateCache();
  }

  async getFiatByIpCountry(ipCountry: string): Promise<Fiat> {
    const name = this.ipCountryToCurrency[ipCountry] ?? Config.defaultCurrency.toUpperCase();
    return this.fiatRepo.findOne({ where: { name } });
  }
}
