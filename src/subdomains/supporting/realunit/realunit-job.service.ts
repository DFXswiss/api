import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { HistoryEventDto } from './dto/realunit.dto';
import { RealUnitService } from './realunit.service';

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
    // per user: settlement transfers already consumed by completed requests (persisted) or earlier in this
    // run. The issuer may settle multiple purchases in a single tx (one transfer event each), so consumption
    // is tracked per transfer event, not per tx. The history carries no per-event id, so a consumed event is
    // identified by its (tx hash, share amount) pairing and counted to also cover same-amount settlements.
    const consumedByUser = new Map<number, Map<string, number>>();

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

        const key = this.settlementKey(settlement.txHash, expectedShares);
        consumed.set(key, (consumed.get(key) ?? 0) + 1);
        await this.transactionRequestService.complete(quote.id, settlement.txHash);

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

  private async getConsumedSettlements(userId: number): Promise<Map<string, number>> {
    const settlements = await this.transactionRequestService.getUsedSettlements(userId);

    const consumed = new Map<string, number>();
    for (const settlement of settlements) {
      const key = this.settlementKey(settlement.settlementTxId, Math.floor(settlement.estimatedAmount));
      consumed.set(key, (consumed.get(key) ?? 0) + 1);
    }

    return consumed;
  }

  // Walks all incoming transfers oldest-first and treats the first n events of each (tx hash, share amount)
  // pairing as consumed, where n is the number of settlements already recorded for that pairing — so a batch
  // settlement tx can complete one request per contained transfer event, but never the same event twice.
  private findUnconsumedSettlement(
    history: HistoryEventDto[],
    consumed: Map<string, number>,
    address: string,
    expectedShares: number,
    minTimestamp: Date,
  ): HistoryEventDto | undefined {
    const incomingTransfers = Util.sort(
      history.filter((e) => e.transfer && Util.equalsIgnoreCase(e.transfer.to, address)),
      'timestamp',
    );

    const seen = new Map<string, number>();

    for (const event of incomingTransfers) {
      const shares = Number(event.transfer.value);
      const key = this.settlementKey(event.txHash, shares);
      const position = (seen.get(key) ?? 0) + 1;
      seen.set(key, position);

      if (position <= (consumed.get(key) ?? 0)) continue;
      if (shares === expectedShares && event.timestamp >= minTimestamp) return event;
    }

    return undefined;
  }

  private settlementKey(txHash: string, shares: number): string {
    return `${txHash.toLowerCase()}|${shares}`;
  }
}
