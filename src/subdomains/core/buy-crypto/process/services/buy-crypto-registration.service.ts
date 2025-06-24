import { Injectable } from '@nestjs/common';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapRepository } from 'src/subdomains/core/buy-crypto/routes/swap/swap.repository';
import { CryptoInput, PayInPurpose, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoService } from './buy-crypto.service';

@Injectable()
export class BuyCryptoRegistrationService {
  constructor(
    private readonly logger: DfxLoggerService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly swapRepository: SwapRepository,
    private readonly payInService: PayInService,
    private readonly transactionHelper: TransactionHelper,
  ) {
    this.logger.create(BuyCryptoRegistrationService);
  }

  async syncReturnTxId(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        cryptoInput: { returnTxId: Not(IsNull()), status: PayInStatus.RETURN_CONFIRMED },
        chargebackCryptoTxId: IsNull(),
      },
      relations: { cryptoInput: true },
    });

    for (const entity of entities) {
      try {
        await this.buyCryptoRepo.update(entity.id, {
          chargebackCryptoTxId: entity.cryptoInput.returnTxId,
          isComplete: true,
        });
      } catch (e) {
        this.logger.error(`Error during buyCrypto payIn returnTxId sync (${entity.id}):`, e);
      }
    }
  }

  async registerCryptoPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    try {
      const buyCryptoPayIns = await this.filterBuyCryptoPayIns(newPayIns);

      buyCryptoPayIns.length > 0 &&
        this.logger.verbose(
          `Registering ${buyCryptoPayIns.length} new buy-crypto(s) from crypto pay-in(s) ID(s): ${buyCryptoPayIns.map(
            (s) => s[0].id,
          )}`,
        );

      await this.createBuyCryptosAndAckPayIns(buyCryptoPayIns);
    } catch (e) {
      this.logger.error('Error while registering new buyCrypto cryptoInput payIns');
    }
  }

  //*** HELPER METHODS ***//

  private async filterBuyCryptoPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Swap][]> {
    const routes = await this.swapRepository.find({
      where: { deposit: Not(IsNull()) },
      relations: { deposit: true, user: { userData: true, wallet: true } },
    });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: Swap[], allPayIns: CryptoInput[]): [CryptoInput, Swap][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = routes.find(
        (r) =>
          (payIn.address.address.toLowerCase() === r.deposit.address.toLowerCase() &&
            r.deposit.blockchainList.includes(payIn.address.blockchain)) ||
          (payIn.isPayment && payIn.paymentLinkPayment?.link.route.id === r.id),
      );

      relevantRoute && result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private async createBuyCryptosAndAckPayIns(payInsPairs: [CryptoInput, Swap][]): Promise<void> {
    for (const [payIn, cryptoRoute] of payInsPairs) {
      try {
        const alreadyExists = await this.buyCryptoRepo.existsBy({ cryptoInput: { id: payIn.id } });

        if (!alreadyExists) {
          const result = await this.transactionHelper.validateInput(payIn);

          if (!result) {
            await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_CRYPTO, cryptoRoute);
            continue;
          }

          await this.buyCryptoService.createFromCryptoInput(payIn, cryptoRoute);
        }

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_CRYPTO, cryptoRoute);
      } catch (e) {
        this.logger.error(`Error during buy-crypto pay-in registration (pay-in ${payIn.id}):`, e);
      }
    }
  }
}
