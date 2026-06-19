import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from './ledger-booking-job.service';
import { LedgerBookingService, LedgerLegInput } from './ledger-booking.service';
import { LedgerAccountService } from './ledger-account.service';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';

const SOURCE_TYPE = 'mark_to_market';
const CHF = 'CHF';

interface AccountBalance {
  accountId: number;
  nativeBalance: number;
  chfBalance: number; // current Σ amountChf (signed, null legs treated as 0)
}

/**
 * Daily mark-to-market (§5.3). Re-values open ASSET/LIABILITY accounts (+ accounts holding needsMark=true legs)
 * to the current FinancialDataLog mark. Append-only: a revaluation-tx supplies the CHF re-valuation (the original
 * needsMark leg is never mutated). Native is unchanged (amount=0 on the FX leg) — only the CHF basis moves; Σ CHF = 0.
 *
 * Runs off-peak at 04:00; the reconciliation job (§7) runs 1h later (05:00) so it compares against tagesaktuell
 * revalued accounts (Minor R13-8). Paginated over the whole open-account universe in Config.ledger.backfillBatchSize
 * windows by id-watermark (no full-scan AND no truncation, analog reconciliation §7.0, §5.3 Minor R1-2).
 */
@Injectable()
export class LedgerMarkToMarketService {
  private readonly logger = new DfxLogger(LedgerMarkToMarketService);

  constructor(
    private readonly jobService: LedgerBookingJobService,
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    private readonly ledgerAccountRepository: LedgerAccountRepository,
    private readonly ledgerLegRepository: LedgerLegRepository,
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_4AM, { process: Process.LEDGER_MARK_TO_MARKET })
  async run(): Promise<void> {
    if (!(await this.jobService.isLedgerReady())) return; // cutover-gate (Blocker R1-6) applies here too

    try {
      await this.markToMarket();
    } catch (e) {
      this.logger.error('Ledger mark-to-market failed', e);
    }
  }

  private async markToMarket(): Promise<void> {
    const now = new Date();

    // §5.3 (Major, analog reconciliation §7.0): paginate the open ASSET/LIABILITY candidate universe by id-watermark
    // — NOT a single truncated `.limit(batchSize)` (which would silently never re-mark accounts beyond the first
    // batchSize once the asset universe grows past it → permanently stale CHF valuation + skewed equity parity §7.6).
    const batchSize = Config.ledger.backfillBatchSize;
    const firstPage = await this.selectCandidates(0, batchSize);
    if (!firstPage.ids.length) return; // no open candidates → no-op (skip the mark preload + fx setup)

    const marks = await this.markService.preload(Util.daysBefore(2, now), now);
    const dayIndex = this.dayIndex(now);
    const fx = await this.fxAccounts();

    let page = firstPage;
    for (;;) {
      for (const account of page.accounts) {
        try {
          await this.revalue(account, marks, now, dayIndex, fx);
        } catch (e) {
          this.logger.error(`Failed to mark-to-market ledger account ${account.id}`, e);
          // failure-isolation: one account failing must not abort the others (each tx is atomic)
        }
      }

      if (page.ids.length < batchSize) break; // last (partial) page → exhausted
      page = await this.selectCandidates(page.maxId, batchSize); // next page by candidate-id watermark
      if (!page.ids.length) break;
    }
  }

  /**
   * §5.3 step 1: open ASSET/LIABILITY accounts (balance ≠ 0) PLUS accounts holding needsMark=true legs, one
   * id-watermark page (accountId > lastId, ASC, limit batchSize) — the caller loops until exhausted (§7.0).
   *
   * The `assetId IS NOT NULL` filter is deliberate and load-bearing: ONLY asset-backed accounts carry a native
   * (non-CHF) exposure that can drift against CHF and thus needs re-marking against the FinancialDataLog mark. The
   * CHF-denominated LIABILITY buckets `LIABILITY/bankTx-return`/`-repeat`/`unattributed` (§3.4: `currency=CHF`,
   * `assetId=NULL`) are opened by the BankTx consumer at `EUR-Mark × amount` (a fixed CHF value) and carry NO native
   * FX exposure on the ledger account — their CHF balance is constant and cannot drift, so there is nothing for a
   * re-mark to correct. The §4.2-Note phrase "the EUR↔CHF drift … is corrected once by the mark-to-market job
   * (FX-Muster 1)" is therefore a no-op for these CHF-stable liabilities: any value mismatch surfaces only at the
   * chargeback/settlement leg as a residual (plugged there via withFxPlug, §4.2-Note B-15), never as a wandering
   * open-balance drift. Including them here (assetId=NULL) would re-mark against a missing asset → no mark → no-op
   * anyway; the filter keeps the candidate set bounded to the accounts a re-mark can actually move.
   */
  private async selectCandidates(
    lastId: number,
    batchSize: number,
  ): Promise<{ ids: number[]; maxId: number; accounts: LedgerAccount[] }> {
    const ids = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.account', 'account')
      .select('leg.accountId', 'accountId')
      .where('account.type IN (:...types)', { types: [AccountType.ASSET, AccountType.LIABILITY] })
      .andWhere('account.assetId IS NOT NULL') // only asset-backed accounts carry a native exposure that can drift
      .andWhere('leg.accountId > :lastId', { lastId }) // id-watermark: paginate the whole candidate universe (§7.0)
      .groupBy('leg.accountId')
      .having('ABS(SUM(leg.amount)) > :tol OR BOOL_OR(leg.needsMark) = true', { tol: 1e-8 })
      .orderBy('leg.accountId', 'ASC')
      .limit(batchSize)
      .getRawMany<{ accountId: number }>()
      .then((rows) => rows.map((r) => r.accountId));

    if (!ids.length) return { ids, maxId: lastId, accounts: [] };

    // findBy returns no guaranteed order; sort by id ASC so the caller's id-watermark advances monotonically
    const accounts = (await this.ledgerAccountRepository.findBy({ id: In(ids) })).sort((a, b) => a.id - b.id);

    return { ids, maxId: Math.max(...ids), accounts };
  }

  // one revaluation-tx per open account per day: ASSET/LIABILITY leg (amount=0, amountChf=diff) / fx-revaluation
  private async revalue(
    account: LedgerAccount,
    marks: LedgerMarkCache,
    bookingDate: Date,
    dayIndex: number,
    fx: { income: LedgerAccount; expense: LedgerAccount },
  ): Promise<void> {
    if (account.assetId == null) return;

    const mark = marks.getMarkAt(account.assetId, bookingDate);
    if (mark == null) return; // still feedless → leave needsMark legs as-is, no phantom revaluation (§5.2 Minor R5-5)

    const balance = await this.accountBalance(account.id);
    if (Math.abs(balance.nativeBalance) <= 1e-8) return; // closed → nothing to revalue

    const newChf = Util.round(mark * balance.nativeBalance, 2);
    const diffChf = Util.round(newChf - balance.chfBalance, 2);
    if (Math.abs(diffChf) < 0.01) return; // sub-cent → nothing to book

    if (await this.alreadyBooked(account.id, dayIndex)) return; // idempotent re-run on the same day

    const fxAccount = diffChf >= 0 ? fx.income : fx.expense;
    const legs: LedgerLegInput[] = [
      { account, amount: 0, priceChf: mark, amountChf: diffChf, needsMark: false }, // CHF re-valuation only, native=0
      { account: fxAccount, amount: -diffChf, priceChf: 1, amountChf: -diffChf, needsMark: false },
    ];

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${account.id}`,
      seq: dayIndex,
      bookingDate,
      valueDate: bookingDate,
      description: `Mark-to-market revaluation of ${account.name}`,
      legs,
    });
  }

  // current Σ amount (native) and Σ amountChf (null treated as 0) for the account
  private async accountBalance(accountId: number): Promise<AccountBalance> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .select('SUM(leg.amount)', 'native')
      .addSelect('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('leg.accountId = :accountId', { accountId })
      .getRawOne<{ native: string | null; chf: string | null }>();

    return {
      accountId,
      nativeBalance: Util.round(+(raw?.native ?? 0), 8),
      chfBalance: Util.round(+(raw?.chf ?? 0), 2),
    };
  }

  // a stable day discriminant for seq (one revaluation-tx per account per day); UTC day number since epoch
  private dayIndex(date: Date): number {
    return Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  }

  private async alreadyBooked(accountId: number, dayIndex: number): Promise<boolean> {
    const count = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .where('tx.sourceType = :sourceType', { sourceType: SOURCE_TYPE })
      .andWhere('tx.sourceId = :sourceId', { sourceId: `${accountId}` })
      .andWhere('tx.seq = :seq', { seq: dayIndex })
      .getCount();

    return count > 0;
  }

  private async fxAccounts(): Promise<{ income: LedgerAccount; expense: LedgerAccount }> {
    return {
      income: await this.accountService.findOrCreate('INCOME/fx-revaluation', AccountType.INCOME, CHF),
      expense: await this.accountService.findOrCreate('EXPENSE/fx-revaluation', AccountType.EXPENSE, CHF),
    };
  }
}
