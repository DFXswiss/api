import { Injectable } from '@nestjs/common';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInNotSellableException } from 'src/shared/payment/exceptions/pay-in-not-sellable-exception';
import { PayInTooSmallException } from 'src/shared/payment/exceptions/pay-in-too-small.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { CryptoRouteRepository } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.repository';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IsNull, Not } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoRegistrationService {
  private readonly logger = new DfxLogger(BuyCryptoRegistrationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly cryptoRouteRepository: CryptoRouteRepository,
    private readonly payInService: PayInService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  async registerCryptoPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const buyCryptoPayIns = await this.filterBuyCryptoPayIns(newPayIns);

    buyCryptoPayIns.length > 0 &&
      this.logger.verbose(
        `Registering ${buyCryptoPayIns.length} new buy-crypto(s) from crypto pay-in(s) ID(s): ${buyCryptoPayIns.map(
          (s) => s[0].id,
        )}`,
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
          await this.transactionHelper.isValidInput(newBuyCrypto.cryptoInput.asset, newBuyCrypto.cryptoInput.amount);
          await this.buyCryptoRepo.save(newBuyCrypto);
        }

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_CRYPTO, cryptoRoute);
      } catch (e) {
        if (e instanceof PayInTooSmallException) {
          await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_CRYPTO, cryptoRoute);

          continue;
        }

        if (e instanceof PayInNotSellableException) {
          await this.payInService.returnPayIn(
            payIn,
            PayInPurpose.BUY_CRYPTO,
            BlockchainAddress.create(cryptoRoute.user.address, cryptoRoute.deposit.blockchain),
            payIn.route,
          );
          continue;
        }

        this.logger.error(`Error during buy-crypto pay-in registration (pay-in ${payIn.id}):`, e);
      }
    }
  }
}
