import { Injectable } from '@nestjs/common';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
  private readonly cache = new AsyncCache<Fiat>(CacheItemResetPeriod.EVERY_5_MINUTES);
  private readonly arrayCache = new AsyncCache<Fiat[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(private fiatRepo: FiatRepository) {}

  async getAllFiat(): Promise<Fiat[]> {
    return this.arrayCache.get('all', () => this.fiatRepo.find());
  }

  async getActiveFiat(): Promise<Fiat[]> {
    return this.fiatRepo.findBy([
      { buyable: true },
      { sellable: true },
      { cardBuyable: true },
      { cardSellable: true },
      { instantBuyable: true },
      { instantSellable: true },
    ]);
  }

  async getFiat(id: number): Promise<Fiat> {
    return this.cache.get(`${id}`, () => this.fiatRepo.findOneBy({ id }));
  }

  async getFiatByName(name: string): Promise<Fiat> {
    return this.cache.get(name, () => this.fiatRepo.findOneBy({ name }));
  }

  async updatePrice(fiatId: number, chfPrice: number) {
    await this.fiatRepo.update(fiatId, { approxPriceChf: chfPrice });
    await this.cache.invalidate();
    await this.arrayCache.invalidate();
  }
}
