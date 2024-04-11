import { Injectable } from '@nestjs/common';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
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
}
