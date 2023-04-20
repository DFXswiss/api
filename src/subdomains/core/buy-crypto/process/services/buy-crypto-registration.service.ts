import { Injectable } from '@nestjs/common';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { CryptoRouteRepository } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.repository';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoInitSpecification } from '../specifications/buy-crypto-init.specification';

@Injectable()
export class BuyCryptoRegistrationService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly cryptoRouteRepository: CryptoRouteRepository,
    private readonly payInService: PayInService,
    private readonly buyCryptoInitSpec: BuyCryptoInitSpecification,
  ) {}

  async registerCryptoPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const buyCryptoPayIns = await this.filterBuyCryptoPayIns(newPayIns);

    buyCryptoPayIns.length > 0 &&
      console.log(
        `Registering ${buyCryptoPayIns.length} new buy-crypto(s) from crypto pay-in(s) ID(s):`,
        buyCryptoPayIns.map((s) => s[0].id),
      );

    await this.createBuyCryptosAndAckPayIns(buyCryptoPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterBuyCryptoPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, CryptoRoute][]> {
    const routes = await this.cryptoRouteRepository.find({
      where: { deposit: Not(IsNull()) },
      relations: ['deposit', 'user', 'user.userData'],
    });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: CryptoRoute[], allPayIns: CryptoInput[]): [CryptoInput, CryptoRoute][] {
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

  private async createBuyCryptosAndAckPayIns(payInsPairs: [CryptoInput, CryptoRoute][]): Promise<void> {
    for (const [payIn, cryptoRoute] of payInsPairs) {
      try {
        const existingBuyCrypto = await this.buyCryptoRepo.findOneBy({ cryptoInput: { id: payIn.id } });

        if (!existingBuyCrypto) {
          const newBuyCrypto = BuyCrypto.createFromPayIn(payIn, cryptoRoute);
          await this.buyCryptoInitSpec.isSatisfiedBy(newBuyCrypto);
          await this.buyCryptoRepo.save(newBuyCrypto);
        }

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_CRYPTO, cryptoRoute);
      } catch (e) {
        if (e instanceof SmallAmountException) {
          await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_CRYPTO, cryptoRoute);

          continue;
        }

        console.error(`Error occurred during pay-in registration at buy-crypto. Pay-in ID: ${payIn.id}`, e);
      }
    }
  }
}
