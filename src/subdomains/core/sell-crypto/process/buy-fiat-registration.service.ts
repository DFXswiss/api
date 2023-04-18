import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { Sell } from '../route/sell.entity';
import { SellRepository } from '../route/sell.repository';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';
import { BuyFiatInitSpecification } from './specifications/buy-fiat-init.specification';

@Injectable()
export class BuyFiatRegistrationService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly sellRepository: SellRepository,
    private readonly payInService: PayInService,
    private readonly buyFiatInitSpec: BuyFiatInitSpecification,
  ) {}

  async registerSellPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const sellPayIns = await this.filterSellPayIns(newPayIns);

    sellPayIns.length > 0 &&
      console.log(
        `Registering ${sellPayIns.length} new buy-fiat(s) from crypto pay-in(s) ID(s):`,
        sellPayIns.map((s) => s[0].id),
      );

    await this.createBuyFiatsAndAckPayIns(sellPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterSellPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Sell][]> {
    const routes = await this.sellRepository.find({
      where: { deposit: Not(IsNull()) },
      relations: ['deposit', 'user', 'user.userData'],
    });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: Sell[], allPayIns: CryptoInput[]): [CryptoInput, Sell][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = routes.find(
        (r) =>
          payIn.address.address.toLowerCase() === r.deposit.address.toLowerCase() &&
          payIn.address.blockchain === r.deposit.blockchain,
      );

      relevantRoute && result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private async createBuyFiatsAndAckPayIns(payInsPairs: [CryptoInput, Sell][]): Promise<void> {
    for (const [payIn, sellRoute] of payInsPairs) {
      try {
        let buyFiat = await this.buyFiatRepo.findOneBy({ cryptoInput: { id: payIn.id } });

        if (!buyFiat) {
          buyFiat = BuyFiat.createFromPayIn(payIn, sellRoute);
          await this.buyFiatInitSpec.isSatisfiedBy(buyFiat);
          await this.buyFiatRepo.save(buyFiat);
        }

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, sellRoute);
      } catch (e) {
        if (e instanceof SmallAmountException) {
          await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_FIAT, sellRoute);

          continue;
        }

        console.error(`Error occurred during pay-in registration at buy-fiat. Pay-in ID: ${payIn.id}`, e);
      }
    }
  }
}
