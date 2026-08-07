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

// The three columns the route match reads, mirroring BuyFiatRegistrationService.
interface RouteIdentifier {
  id: number;
  address: string;
  blockchains: string;
}

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

  // Matching reads three values per route, so the candidate scan selects exactly those and returns
  // raw rows — no entity is constructed. Reading every route as a full entity here was the single
  // most expensive statement of the cron run, measured at 7.0-13.0 s against the whole swap table
  // (DFXServer/server#1223): Swap declares four eager relations (asset, deposit, targetDeposit,
  // route) and the call added user, userData and wallet on top, so a whole-row select fanned out
  // over seven joined tables for every route in the table. The blocking part is not the SQL, which
  // is asynchronous, but turning that result set into entities, which is not — hence getRawMany
  // rather than a projected find(), matching BuyFiatRegistrationService.filterSellPayIns. Only the
  // routes that actually matched are then read back as entities, because createFromCryptoInput
  // reads the Swap's eager asset (buy-crypto.service.ts) and ignorePayIn / acknowledgePayIn need
  // the user relations.
  private async filterBuyCryptoPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Swap][]> {
    // innerJoin carries the `deposit IS NOT NULL` restriction the previous find() spelled out, so a
    // route without a deposit stays unmatched — including on the payment branch, which matches by id.
    const candidates = await this.swapRepository
      .createQueryBuilder('swap')
      .innerJoin('swap.deposit', 'deposit')
      .select('swap.id', 'id')
      .addSelect('deposit.address', 'address')
      .addSelect('deposit.blockchains', 'blockchains')
      .getRawMany<RouteIdentifier>();

    const matches = this.pairRoutesWithPayIns(candidates, allPayIns);
    if (matches.length === 0) return [];

    const routes = await this.swapRepository.find({
      where: { id: In([...new Set(matches.map(([, route]) => route.id))]) },
      relations: { deposit: true, user: { userData: true, wallet: true } },
    });
    const routeById = new Map(routes.map((route) => [route.id, route]));

    const pairs: [CryptoInput, Swap][] = [];

    for (const [payIn, match] of matches) {
      const route = routeById.get(match.id);

      // A route that disappeared between the two reads leaves its pay-in for the next run rather
      // than registering it against a half-loaded route. Logged because the pay-in would otherwise
      // be retried every minute without a trace.
      if (!route) {
        this.logger.warn(`Swap route ${match.id} vanished before read-back, skipping pay-in ${payIn.id}`);
        continue;
      }

      pairs.push([payIn, route]);
    }

    return pairs;
  }

  private pairRoutesWithPayIns(routes: RouteIdentifier[], allPayIns: CryptoInput[]): [CryptoInput, RouteIdentifier][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = this.findMatchingRoute(payIn, routes);
      if (relevantRoute) result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private findMatchingRoute(payIn: CryptoInput, routes: RouteIdentifier[]): RouteIdentifier | undefined {
    if (payIn.isPayment) {
      const paymentRouteId =
        payIn.paymentLinkPayment?.link.linkConfigObj.payoutRouteId ?? payIn.paymentLinkPayment?.link.route.id;

      return routes.find((r) => paymentRouteId === r.id);
    } else {
      return routes.find(
        (r) =>
          payIn.address.address.toLowerCase() === r.address.toLowerCase() &&
          // Split rather than the substring test the sell side uses: `blockchains` is a
          // semicolon-joined list, and `'BitcoinCash'.includes('Bitcoin')` would match the wrong chain.
          r.blockchains.split(';').includes(payIn.address.blockchain),
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
