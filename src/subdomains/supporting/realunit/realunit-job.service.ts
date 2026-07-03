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
    // per user: settlement txs already consumed by earlier runs (persisted) or earlier in this run
    const usedTxIdsByUser = new Map<number, Set<string>>();

    for (const quote of openQuotes) {
      try {
        const address = quote.user.address;
        const expectedShares = Math.floor(quote.estimatedAmount);

        let history = historyCache.get(address);
        if (!history) {
          history = (await this.realunitService.getAccountHistory(address, 100)).history;
          historyCache.set(address, history);
        }

        let usedTxIds = usedTxIdsByUser.get(quote.user.id);
        if (!usedTxIds) {
          usedTxIds = new Set(await this.transactionRequestService.getUsedSettlementTxIds(quote.user.id));
          usedTxIdsByUser.set(quote.user.id, usedTxIds);
        }

        // quotes are ordered oldest-first, so match the oldest unused settlement transfer
        const settlement = history
          .filter(
            (e) =>
              e.transfer &&
              !usedTxIds.has(e.txHash) &&
              Util.equalsIgnoreCase(e.transfer.to, address) &&
              Number(e.transfer.value) === expectedShares &&
              e.timestamp >= quote.created,
          )
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          .at(0);
        if (!settlement) continue;

        usedTxIds.add(settlement.txHash);
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
}
