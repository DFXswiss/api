import { Injectable } from '@nestjs/common';
import { CryptoRoute } from 'src/mix/models/crypto-route/crypto-route.entity';
import { CryptoRouteRepository } from 'src/mix/models/crypto-route/crypto-route.repository';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoRegistrationService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly cryptoRouteRepository: CryptoRouteRepository,
    private readonly payInService: PayInService,
  ) {}

  async registerCryptoPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const buyCryptoPayIns = await this.filterBuyCryptoPayIns(newPayIns);
    await this.createBuyCryptosAndAckPayIns(buyCryptoPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterBuyCryptoPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, CryptoRoute][]> {
    const routes = await this.cryptoRouteRepository.find({ where: { deposit: Not(IsNull()) }, relations: ['deposit'] });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: CryptoRoute[], allPayIns: CryptoInput[]): [CryptoInput, CryptoRoute][] {
    const result = [];

    for (const route of routes) {
      const relevantPayIn = allPayIns.find(
        (p) => p.address.address === route.deposit.address && p.address.blockchain === route.deposit.blockchain,
      );

      relevantPayIn && result.push([relevantPayIn, route]);
    }

    return result;
  }

  private async createBuyCryptosAndAckPayIns(payInsPairs: [CryptoInput, CryptoRoute][]): Promise<void> {
    for (const [payIn, cryptoRoute] of payInsPairs) {
      const existingPayIn = await this.buyCryptoRepo.findOne({ cryptoInput: payIn });

      if (existingPayIn) {
        await this.payInService.acknowledgePayIn(payIn, PayInPurpose.BUY_CRYPTO);
        continue;
      }

      const newBuyCrypto = BuyCrypto.createFromPayIn(payIn, cryptoRoute);

      await this.buyCryptoRepo.save(newBuyCrypto);
      await this.payInService.acknowledgePayIn(payIn, PayInPurpose.BUY_CRYPTO);
    }
  }
}
