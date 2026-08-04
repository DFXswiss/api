import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapRepository } from 'src/subdomains/core/buy-crypto/routes/swap/swap.repository';
import { CryptoInput, PayInPurpose, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { In, IsNull, Not } from 'typeorm';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoService } from './buy-crypto.service';

@Injectable()
export class BuyCryptoRegistrationService {
  private readonly logger = new DfxLogger(BuyCryptoRegistrationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly swapRepository: SwapRepository,
    private readonly payInService: PayInService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

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

      if (buyCryptoPayIns.length > 0)
        this.logger.verbose(
          `Registering ${buyCryptoPayIns.length} new buy-crypto(s) from crypto pay-in(s) ID(s): ${buyCryptoPayIns.map(
            (s) => s[0].id,
          )}`,
        );

      await this.createBuyCryptosAndAckPayIns(buyCryptoPayIns);
    } catch (e) {
      this.logger.error('Error while registering new buyCrypto pay-ins:', e);
    }
  }

  //*** HELPER METHODS ***//

  // Matching reads nothing but the route id and its deposit, so the candidate scan is projected down
  // to those columns with the eager relations (asset, deposit, route) switched off. Loading every
  // route as a full entity here was the single most expensive statement of the cron run — measured at
  // 7.0-13.0 s against the whole swap table (DFXServer/server#1223) — because a whole-row select of
  // the routes fans out over asset, deposit, route, user, userData and wallet, and hydrating that
  // result set into entities blocks the event loop. Only the routes that actually match are then
  // re-read in full, since createFromCryptoInput / ignorePayIn / acknowledgePayIn need the user
  // relations. In practice that is a handful of rows instead of the entire table.
  private async filterBuyCryptoPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Swap][]> {
    const candidates = await this.swapRepository.find({
      where: { deposit: Not(IsNull()) },
      select: { id: true, deposit: { id: true, address: true, blockchains: true } },
      relations: { deposit: true },
      loadEagerRelations: false,
    });

    const matches = this.pairRoutesWithPayIns(candidates, allPayIns);
    if (matches.length === 0) return [];

    const routes = await this.swapRepository.find({
      where: { id: In(matches.map(([_, route]) => route.id)) },
      relations: { deposit: true, user: { userData: true, wallet: true } },
    });
    const routeById = new Map(routes.map((route) => [route.id, route]));

    // A route can disappear between the two reads; such a pay-in is left for the next run rather
    // than registered against a half-loaded route.
    return matches
      .map(([payIn, match]) => [payIn, routeById.get(match.id)] as [CryptoInput, Swap])
      .filter(([_, route]) => route != null);
  }

  private pairRoutesWithPayIns(routes: Swap[], allPayIns: CryptoInput[]): [CryptoInput, Swap][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = this.findMatchingRoute(payIn, routes);
      if (relevantRoute) result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private findMatchingRoute(payIn: CryptoInput, routes: Swap[]): Swap | undefined {
    if (payIn.isPayment) {
      const paymentRouteId =
        payIn.paymentLinkPayment?.link.linkConfigObj.payoutRouteId ?? payIn.paymentLinkPayment?.link.route.id;

      return routes.find((r) => paymentRouteId === r.id);
    } else {
      return routes.find(
        (r) =>
          payIn.address.address.toLowerCase() === r.deposit.address.toLowerCase() &&
          r.deposit.blockchainList.includes(payIn.address.blockchain),
      );
    }
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
