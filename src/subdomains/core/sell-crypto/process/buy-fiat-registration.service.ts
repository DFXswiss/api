import { Injectable } from '@nestjs/common';
import { RouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
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

    for (const payIn of allPayIns) {
      const relevantRoute = routes.find(
        (r) => payIn.address.address === r.deposit.address && payIn.address.blockchain === r.deposit.blockchain,
      );

      relevantRoute && result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private async createBuyFiatsAndAckPayIns(payInsPairs: [CryptoInput, Sell][]): Promise<void> {
    for (const [payIn, sellRoute] of payInsPairs) {
      try {
        const existingBuyFiat = await this.buyFiatRepo.findOne({ cryptoInput: payIn });

        if (existingBuyFiat) {
          await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.SELL_CRYPTO, sellRoute);
          continue;
        }

        // ignore DeFiChain AccountToUtxos for sell
        if (sellRoute.type === RouteType.SELL && payIn.txType === 'AccountToUtxos') {
          console.log('Ignoring AccountToUtxos DeFiChain input on sell route. Pay-in:', payIn);
          await this.payInService.ignorePayIn(payIn, PayInPurpose.SELL_CRYPTO, sellRoute);
          continue;
        }

        await this.createNewBuyFiatAndAck(payIn, sellRoute);

        const newBuyFiat = BuyFiat.createFromPayIn(payIn, sellRoute);

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.SELL_CRYPTO, sellRoute);
        await this.buyFiatRepo.save(newBuyFiat);
      } catch (e) {
        console.error(`Error occurred during pay-in registration at buy-fiat. Pay-in ID: ${payIn.id}`, e);
      }
    }
  }

  private async createNewBuyFiatAndAck(payIn: CryptoInput, sellRoute: Sell): Promise<void> {
    try {
      const newBuyFiat = BuyFiat.createFromPayIn(payIn, sellRoute);

      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.SELL_CRYPTO, sellRoute);
      await this.buyFiatRepo.save(newBuyFiat);
    } catch (e) {
      if (e instanceof SmallAmountException) {
        await this.payInService.ignorePayIn(payIn, PayInPurpose.SELL_CRYPTO, sellRoute);

        return;
      }

      throw e;
    }
  }
}
