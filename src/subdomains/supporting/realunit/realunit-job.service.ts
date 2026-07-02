import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
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
  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async completeSettledQuotes() {
    if (DisabledProcess(Process.REALUNIT_QUOTE_COMPLETION)) return;

    const realuAsset = await this.realunitService.getRealuAsset();
    const openQuotes = await this.transactionRequestService.getOpenBuyQuotes(realuAsset.id);
    if (!openQuotes.length) return;

    // quotes are ordered oldest-first and each settlement tx settles at most one quote
    const usedTxHashes = new Set<string>();

    for (const quote of openQuotes) {
      try {
        const expectedShares = Math.floor(quote.estimatedAmount);

        const { history } = await this.realunitService.getAccountHistory(quote.user.address, 100);
        const settlement = history.find(
          (e) =>
            e.transfer &&
            !usedTxHashes.has(e.txHash) &&
            Util.equalsIgnoreCase(e.transfer.to, quote.user.address) &&
            Number(e.transfer.value) === expectedShares &&
            e.timestamp >= quote.created,
        );
        if (!settlement) continue;

        usedTxHashes.add(settlement.txHash);
        await this.transactionRequestService.complete(quote.id);

        this.logger.info(
          `Completed settled quote ${quote.id}: ${expectedShares} shares received in tx ${settlement.txHash}`,
        );
      } catch (e) {
        // address not yet indexed by the ponder (no on-chain events yet)
        if (e instanceof NotFoundException) continue;

        this.logger.error(`Failed to check quote ${quote.id} for on-chain settlement:`, e);
      }
    }
  }
}
