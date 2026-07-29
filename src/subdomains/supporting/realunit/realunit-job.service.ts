import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { HistoryEventDto } from './dto/realunit.dto';
import { RealUnitService } from './realunit.service';

// settlement transfers of a user that are no longer available: exact event ids of completed
// requests, plus the tx hashes of requests completed before the event id was recorded
interface ConsumedSettlements {
  eventIds: Set<string>;
  legacyTxHashes: Set<string>;
}

@Injectable()
export class RealUnitJobService {
  private readonly logger = new DfxLogger(RealUnitJobService);

  constructor(
    private readonly realunitService: RealUnitService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {}

  // Completes open REALU buy quotes as soon as the shares arrive on-chain. Share allocations
  // triggered outside the DFX payment flow (e.g. booked manually by the issuer) would otherwise
  // leave the quote in WaitingForPayment and keep showing a pending payment to the customer.
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.REALUNIT_QUOTE_COMPLETION, timeout: 1800 })
  async completeSettledQuotes(): Promise<void> {
    const realuAsset = await this.realunitService.getRealuAsset();
    const openQuotes = await this.transactionRequestService.getOpenBuyQuotes(realuAsset.id);
    if (!openQuotes.length) return;

    const historyCache = new Map<string, HistoryEventDto[]>();
    // per user: settlement transfers already consumed by completed requests (persisted) or earlier in
    // this run. The issuer may settle multiple purchases in a single tx (one transfer event each), so
    // consumption is tracked per transfer event via its indexer event id, not per tx.
    const consumedByUser = new Map<number, ConsumedSettlements>();

    for (const quote of openQuotes) {
      try {
        const address = quote.user.address;
        const expectedShares = Math.floor(quote.estimatedAmount);

        let history = historyCache.get(address);
        if (!history) {
          history = (await this.realunitService.getAccountHistory(address, 100)).history;
          historyCache.set(address, history);
        }

        let consumed = consumedByUser.get(quote.user.id);
        if (!consumed) {
          consumed = await this.getConsumedSettlements(quote.user.id);
          consumedByUser.set(quote.user.id, consumed);
        }

        // quotes are ordered oldest-first, so match the oldest unconsumed settlement transfer
        const settlement = this.findUnconsumedSettlement(history, consumed, address, expectedShares, quote.created);
        if (!settlement) continue;

        consumed.eventIds.add(settlement.id);
        await this.transactionRequestService.complete(quote.id, {
          txId: settlement.txHash,
          eventId: settlement.id,
        });

        this.logger.info(
          `Completed settled quote ${quote.id}: ${expectedShares} shares received from ${settlement.transfer.from} in tx ${settlement.txHash}`,
        );
      } catch (e) {
        // address not yet indexed by the ponder (no on-chain events yet)
        if (e instanceof NotFoundException) continue;

        this.logger.error(`Failed to check quote ${quote.id} for on-chain settlement:`, e);
      }
    }
  }

  // Resolves RealUnit W2W transfer requests stuck in PROCESSING after a crash/restart between the
  // atomic claim and the broadcast/callback in confirmTransfer — see
  // RealUnitService.reconcilePendingTransfers for the actual reconciliation logic.
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.REALUNIT_TRANSFER_RECONCILIATION, timeout: 1800 })
  async reconcilePendingTransfers(): Promise<void> {
    await this.realunitService.reconcilePendingTransfers();
  }

  // --- HELPER METHODS --- //

  private async getConsumedSettlements(userId: number): Promise<ConsumedSettlements> {
    const settlements = await this.transactionRequestService.getUsedSettlements(userId);

    return {
      eventIds: new Set(settlements.filter((s) => s.settlementEventId).map((s) => s.settlementEventId)),
      // requests completed before the event id existed recorded only the tx hash. Which of its transfer
      // events they consumed is not recoverable, so the whole tx stays blocked for them — a settlement
      // assigned twice is worse than one that needs a manual completion
      legacyTxHashes: new Set(
        settlements.filter((s) => !s.settlementEventId).map((s) => s.settlementTxId.toLowerCase()),
      ),
    };
  }

  // Matches the oldest incoming transfer that carries the expected share amount, was mined after the
  // quote was created and has not been consumed by another request.
  private findUnconsumedSettlement(
    history: HistoryEventDto[],
    consumed: ConsumedSettlements,
    address: string,
    expectedShares: number,
    minTimestamp: Date,
  ): HistoryEventDto | undefined {
    const incomingTransfers = Util.sort(
      history.filter((e) => e.transfer && Util.equalsIgnoreCase(e.transfer.to, address)),
      'timestamp',
    );

    return incomingTransfers.find(
      (e) =>
        !consumed.eventIds.has(e.id) &&
        !consumed.legacyTxHashes.has(e.txHash.toLowerCase()) &&
        Number(e.transfer.value) === expectedShares &&
        e.timestamp >= minTimestamp,
    );
  }
}
