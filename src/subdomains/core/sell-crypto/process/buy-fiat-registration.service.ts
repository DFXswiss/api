import { Injectable } from '@nestjs/common';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { Sell } from '../route/sell.entity';
import { SellRepository } from '../route/sell.repository';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatRegistrationService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly sellRepository: SellRepository,
    private readonly payInService: PayInService,
  ) {}

  async registerSellPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const sellPayIns = await this.filterSellPayIns(newPayIns);
    await this.createBuyFiatsAndAckPayIns(sellPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterSellPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Sell][]> {
    const routes = await this.sellRepository.find({ where: { deposit: Not(IsNull()) }, relations: ['deposit'] });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: Sell[], allPayIns: CryptoInput[]): [CryptoInput, Sell][] {
    const result = [];

    for (const route of routes) {
      const relevantPayIn = allPayIns.find(
        (p) => p.address.address === route.deposit.address && p.address.blockchain === route.deposit.blockchain,
      );

      relevantPayIn && result.push([relevantPayIn, route]);
    }

    return result;
  }

  private async createBuyFiatsAndAckPayIns(payInsPairs: [CryptoInput, Sell][]): Promise<void> {
    for (const [payIn, sellRoute] of payInsPairs) {
      const existingPayIn = await this.buyFiatRepo.findOne({ cryptoInput: payIn });

      if (existingPayIn) {
        await this.payInService.acknowledgePayIn(payIn, PayInPurpose.SELL_CRYPTO);
        continue;
      }

      const newBuyFiat = BuyFiat.createFromPayIn(payIn, sellRoute);

      await this.buyFiatRepo.save(newBuyFiat);
      await this.payInService.acknowledgePayIn(payIn, PayInPurpose.SELL_CRYPTO);
    }
  }
}
