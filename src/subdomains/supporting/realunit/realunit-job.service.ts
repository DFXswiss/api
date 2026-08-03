import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
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
  @DfxCron(CronExpression.EVERY_MINUTE, {
    scope: CronScope.WORKER,
    process: Process.REALUNIT_QUOTE_COMPLETION,
    timeout: 1800,
  })
  async completeSettledQuotes(): Promise<void> {
    const realuAsset = await this.realunitService.getRealuAsset();
    const openQuotes = await this.transactionRequestService.getOpenBuyQuotes(realuAsset.id);
    if (!openQuotes.length) return;

    const historyCache = new Map<string, HistoryEventDto[]>();
    // event ids consumed by completed requests (of any user - the column is globally unique) or
    // earlier in this run. The issuer may settle multiple purchases in a single tx, one transfer
    // event each, so consumption is tracked per transfer event via its indexer event id, not per tx
    const consumedEventIds = new Set(await this.transactionRequestService.getConsumedSettlementEventIds());
    // per address: settlement txs of requests completed before event ids were recorded
    const legacyTxIdsByAddress = new Map<string, Set<string>>();

    for (const quote of openQuotes) {
      try {
        const address = quote.user.address;
        const expectedShares = Math.floor(quote.estimatedAmount);

        let history = historyCache.get(address);
        if (!history) {
          history = (await this.realunitService.getAccountHistory(address, 100)).history;
          historyCache.set(address, history);
        }

        let legacyTxIds = legacyTxIdsByAddress.get(address.toLowerCase());
        if (!legacyTxIds) {
          legacyTxIds = await this.getLegacySettlementTxIds(address);
          legacyTxIdsByAddress.set(address.toLowerCase(), legacyTxIds);
        }

        // quotes are ordered oldest-first, so match the oldest unconsumed settlement transfer
        const settlement = this.findUnconsumedSettlement(
          history,
          consumedEventIds,
          legacyTxIds,
          address,
          expectedShares,
          quote.created,
        );
        if (!settlement) continue;

        const claimed = await this.transactionRequestService.completeSettlement(quote.id, {
          txId: settlement.txHash,
          eventId: settlement.id,
        });
        // another instance claimed this quote first — leave the event available for the next run
        if (!claimed) continue;

        consumedEventIds.add(settlement.id);

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
  @DfxCron(CronExpression.EVERY_5_MINUTES, {
    scope: CronScope.WORKER,
    process: Process.REALUNIT_TRANSFER_RECONCILIATION,
    timeout: 1800,
  })
  async reconcilePendingTransfers(): Promise<void> {
    await this.realunitService.reconcilePendingTransfers();
  }

  // --- HELPER METHODS --- //

  private async getLegacySettlementTxIds(address: string): Promise<Set<string>> {
    const txIds = await this.transactionRequestService.getLegacySettlementTxIds(address);

    // which transfer event of such a tx the request consumed is not recoverable, so the whole tx
    // stays blocked for this address - a settlement assigned twice is worse than one that needs a
    // manual completion
    return new Set(txIds.map((txId) => txId.toLowerCase()));
  }

  // Matches the oldest incoming transfer that carries the expected share amount, was mined after the
  // quote was created and has not been consumed by another request.
  private findUnconsumedSettlement(
    history: HistoryEventDto[],
    consumedEventIds: Set<string>,
    legacyTxIds: Set<string>,
    address: string,
    expectedShares: number,
    minTimestamp: Date,
  ): HistoryEventDto | undefined {
    const incomingTransfers = Util.sort(
      history.filter(
        (e) =>
          e.transfer &&
          Util.equalsIgnoreCase(e.transfer.to, address) &&
          // a settlement is paid out by the issuer. Without this the buyer could complete an open
          // quote by sending the shares from a second wallet of their own
          Util.equalsIgnoreCase(e.transfer.from, Config.blockchain.realunit.brokerbotAddress) &&
          // the indexer writes a self-transfer to this account's history twice, once as …-to and
          // once as …-from; both rows carry the same transfer and would settle two quotes from one
          // physical transfer. Only reachable if the account is the issuer itself, but free to rule out
          !Util.equalsIgnoreCase(e.transfer.from, e.transfer.to),
      ),
      'timestamp',
    );

    return incomingTransfers.find(
      (e) =>
        !consumedEventIds.has(e.id) &&
        !legacyTxIds.has(e.txHash.toLowerCase()) &&
        Number(e.transfer.value) === expectedShares &&
        e.timestamp >= minTimestamp,
    );
  }
}
