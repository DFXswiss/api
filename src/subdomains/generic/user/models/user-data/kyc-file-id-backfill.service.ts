import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { KycLogType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { UserService } from '../user/user.service';
import { UserData } from './user-data.entity';
import { UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';
import { UserDataService } from './user-data.service';

// Both bounds are the observed edges of the outage in the id sequence itself, not a deploy date:
// assignment ran normally up to kycFileId 6172 (2026-05-21T14:00:08Z), produced nothing at all for
// the next six weeks, and resumed at 6173 (2026-07-03T15:47:39Z) once #4023 reached prod.
//
// The ceiling matters as much as the floor. #4023 restored assignment, so a row that is still
// `kycFileId IS NULL` after a qualifying crossing on the far side of it is not a victim of the bug
// — it is a row the live rule declined. Without the ceiling this stops being a repair of a closed
// window and becomes a re-derivation of current AML state, whose result would depend on which
// manual reviews happen to be open the minute it runs.
const AFFECTED_WINDOW_START = new Date('2026-05-21T14:00:08Z');
const AFFECTED_WINDOW_END = new Date('2026-07-03T15:47:39Z');

// Matches the live AML volume span in both preparation services:
// Util.daysBefore(30, tx.created) … Util.daysAfter(30, tx.created), the forward half capped at the
// verdict (see computeCrossing).
const VOLUME_WINDOW_DAYS = 30;

const MAX_ASSIGNMENT_ATTEMPTS = 5;

export interface BackfillOptions {
  dryRun: boolean;
}

export interface Crossing {
  userDataId: number;
  crossingDate: Date;
  crossingTxId: number;
  crossingTxType: TransactionTypeInternal;
  volumeAtCrossing: number;
}

export interface BackfillReport {
  candidates: number;
  crossings: number;
  assigned: number;
  /** Already carried an id by the time the write ran — a live tick or an earlier run got there. */
  skipped: number;
  /** Threw during assignment. `assigned + skipped + failed` always equals `crossings`. */
  failed: number;
  /** Merged since the window opened; volume can no longer be attributed. For manual review. */
  excludedMergedIds: number[];
  /** Every crossing, not a sample — the dry run has to be reviewable in full before the live pass. */
  crossingDetail: Crossing[];
  dryRun: boolean;
}

export interface BackfillStartResult {
  started: boolean;
  dryRun: boolean;
  message: string;
}

/**
 * One-shot backfill of `kycFileId` / `amlListAddedDate` for rows the AML flow failed to assign
 * during the outage fixed by #4023. Background in PR #4041.
 *
 * Reproduces the live rule rather than approximating it: per-transaction volume comes from
 * `TransactionHelper.getVolumeSince`, the same call `aml.service.postProcessing` is fed by, so the
 * ±30d span and its inclusion rule (`amlCheck != FAIL`) match by construction — though the span is
 * cut off at the verdict, see `computeCrossing`, and the rule for selecting the crossing itself is
 * narrower, see `isEligibleCrossing`. The transaction's own contribution uses the stored
 * `amountInChf`, the value priced at AML time, rather than re-pricing at today's rate.
 *
 * The first transaction whose volume exceeds `monthlyDefaultWoKyc` is the crossing, and its
 * `created` supplies `amlListAddedDate` where the row does not already carry one, so
 * `getKycFileYearlyStats` keeps the per-year shape it would have had. Crossings are assigned
 * oldest-first so ids stay monotonic with time.
 *
 * Idempotent: candidates are filtered on `kycFileId IS NULL`, the UPDATE is conditional on the
 * same, and the partial unique index from #4023 is the DB-level backstop behind the retry.
 */
@Injectable()
export class KycFileIdBackfillService {
  private readonly logger = new DfxLogger(KycFileIdBackfillService);

  private isRunning = false;

  constructor(
    private readonly userDataRepo: UserDataRepository,
    @InjectRepository(BuyCrypto) private readonly buyCryptoRepo: Repository<BuyCrypto>,
    @InjectRepository(BuyFiat) private readonly buyFiatRepo: Repository<BuyFiat>,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly transactionHelper: TransactionHelper,
    private readonly kycLogService: KycLogService,
  ) {}

  /**
   * Starts the run in the background and returns immediately: a full pass is minutes of work (one
   * `getVolumeSince` per candidate transaction) and would outlive the request timeout, so the
   * report goes to the log rather than the response.
   */
  start(options: BackfillOptions): BackfillStartResult {
    if (this.isRunning) throw new ConflictException('A backfill run is already in progress');
    this.isRunning = true;

    void this.run(options)
      .then((report) => this.logger.info(`Backfill report: ${JSON.stringify(report)}`))
      .catch((e) => this.logger.error('Backfill run failed:', e))
      .finally(() => (this.isRunning = false));

    return {
      started: true,
      dryRun: options.dryRun,
      message: `Backfill started (dryRun=${options.dryRun}); report is written to the log on completion.`,
    };
  }

  private async run(options: BackfillOptions): Promise<BackfillReport> {
    const { candidateIds, excludedMergedIds } = await this.findCandidateIds();

    this.logger.info(
      `Backfill starting: ${candidateIds.length} candidates, ${excludedMergedIds.length} excluded as merged ` +
        `(dryRun=${options.dryRun})`,
    );

    const threshold = Config.tradingLimits.monthlyDefaultWoKyc;
    const crossings: Crossing[] = [];

    for (const [index, userDataId] of candidateIds.entries()) {
      const crossing = await this.computeCrossing(userDataId, threshold);
      if (crossing) crossings.push(crossing);

      if ((index + 1) % 250 === 0)
        this.logger.info(`Backfill scanning: ${index + 1}/${candidateIds.length}, ${crossings.length} crossings`);
    }

    crossings.sort((a, b) => a.crossingDate.getTime() - b.crossingDate.getTime());

    const report: BackfillReport = {
      candidates: candidateIds.length,
      crossings: crossings.length,
      assigned: 0,
      skipped: 0,
      failed: 0,
      excludedMergedIds,
      crossingDetail: crossings,
      dryRun: options.dryRun,
    };

    if (options.dryRun) return report;

    for (const crossing of crossings) {
      try {
        const kycFileId = await this.assign(crossing);

        if (kycFileId == null) report.skipped++;
        else report.assigned++;
      } catch (e) {
        report.failed++;
        this.logger.error(
          `Backfill failed for userData ${crossing.userDataId} (crossing tx ${crossing.crossingTxId}):`,
          e,
        );
      }
    }

    return report;
  }

  /**
   * Candidates are driven off the transactions rather than off `user_data.updated`: the failed
   * assignment wrote nothing, so `updated` only moved where some unrelated write happened to touch
   * the row.
   *
   * Deliberately a superset — this only decides who gets examined, and `computeCrossing` applies
   * the real trigger rule. Narrowing here would just duplicate that predicate in a second place.
   */
  private async findCandidateIds(): Promise<{ candidateIds: number[]; excludedMergedIds: number[] }> {
    const window = { from: AFFECTED_WINDOW_START, to: AFFECTED_WINDOW_END };

    const [fromBuyCrypto, fromBuyFiat] = await Promise.all([
      this.buyCryptoRepo
        .createQueryBuilder('bc')
        .leftJoin('bc.buy', 'buy')
        .leftJoin('bc.cryptoRoute', 'cryptoRoute')
        .leftJoin('buy.user', 'buyUser')
        .leftJoin('cryptoRoute.user', 'routeUser')
        .select('COALESCE(buyUser.userDataId, routeUser.userDataId)', 'userDataId')
        .where('bc.amlCheck = :pass', { pass: CheckStatus.PASS })
        .andWhere('bc.priceDefinitionAllowedDate >= :from', window)
        .andWhere('bc.priceDefinitionAllowedDate < :to', window)
        .groupBy('COALESCE(buyUser.userDataId, routeUser.userDataId)')
        .getRawMany<{ userDataId: number | null }>(),
      this.buyFiatRepo
        .createQueryBuilder('bf')
        .leftJoin('bf.sell', 'sell')
        .leftJoin('sell.user', 'sellUser')
        .select('sellUser.userDataId', 'userDataId')
        .where('bf.amlCheck = :pass', { pass: CheckStatus.PASS })
        .andWhere('bf.priceDefinitionAllowedDate >= :from', window)
        .andWhere('bf.priceDefinitionAllowedDate < :to', window)
        .groupBy('sellUser.userDataId')
        .getRawMany<{ userDataId: number | null }>(),
    ]);

    const withTx = [...fromBuyCrypto, ...fromBuyFiat].map((r) => r.userDataId).filter((id): id is number => id != null);
    if (!withTx.length) return { candidateIds: [], excludedMergedIds: [] };

    const candidates = await this.userDataRepo.find({
      where: { id: In([...new Set(withTx)]), kycFileId: IsNull(), status: Not(UserDataStatus.MERGED) },
      select: { id: true },
      loadEagerRelations: false,
    });

    // Accounts merged since the outage began are set aside rather than backfilled. Volume is read
    // from the account's *current* users, so a merge folds two histories into one: two accounts
    // that each moved 600 CHF while separate now look like a single account that moved 1200 and
    // would be handed an id neither of them earned. Untangling that needs the merge history
    // replayed, which is not worth building into a one-shot — they are reported for manual review
    // instead, erring toward missing a row rather than inventing a compliance record.
    const ids = candidates.map((c) => c.id);
    const excludedMergedIds = await this.kycLogService.getMergedUserDataIdsSince(ids, AFFECTED_WINDOW_START);

    return { candidateIds: ids.filter((id) => !excludedMergedIds.includes(id)), excludedMergedIds };
  }

  /**
   * The rule for which transaction may be *the* crossing — i.e. the one whose assignment was lost.
   *
   * `PASS`, not `!= FAIL`: the live assignment sits inside `if (entity.amlCheck === PASS)`
   * (`aml.service.ts`), so a Pending or GSheet transaction never triggered it. `!= FAIL` is the
   * rule for the volume *sum*; `getVolumeSince` applies that internally and it must not be lifted
   * up here. The distinction is not academic — crossing the threshold is itself what pushes a
   * transaction to non-PASS when kycLevel < 50 / no bank-tx verification / no letter
   * (`aml-helper.service.ts`), so `!= FAIL` would select preferentially for exactly the rows the
   * live rule declined.
   *
   * Held as an explicit predicate rather than left to the query's WHERE clause: this is the
   * correctness boundary, so it should be assertable without a database.
   */
  private isEligibleCrossing(tx: BuyCrypto | BuyFiat): boolean {
    const verdictAt = tx.priceDefinitionAllowedDate;

    return (
      tx.amlCheck === CheckStatus.PASS &&
      // The window bounds are assignment times, so they have to be compared against when the
      // verdict was rendered — not when the transaction was created. A transaction created before
      // the outage but held in review until inside it did lose its assignment; one created inside
      // it but only approved afterwards did not.
      verdictAt != null &&
      verdictAt >= AFFECTED_WINDOW_START &&
      verdictAt < AFFECTED_WINDOW_END &&
      // Payment pay-ins never trigger the assignment (aml.service.postProcessing).
      tx.cryptoInput?.txType !== PayInType.PAYMENT &&
      tx.amountInChf != null
    );
  }

  /**
   * Walks the candidate's in-window transactions oldest-first and returns the first eligible one
   * whose volume — computed by the same helper the live AML flow uses — exceeds the threshold.
   */
  private async computeCrossing(userDataId: number, threshold: number): Promise<Crossing | null> {
    const users = await this.userService.getAllUserDataUsers(userDataId);
    if (!users.length) return null;

    const txs = await this.loadWindowTransactions(users.map((u) => u.id));

    for (const tx of txs) {
      if (!this.isEligibleCrossing(tx)) continue;

      // Same helper and same ±30d span as the live rule, but the forward half is cut off at the
      // moment the verdict was rendered. Live, that half is all but empty — transactions after the
      // one being judged do not exist yet, and any created since carry a null `amlCheck`, which
      // `!= FAIL` excludes. Replaying months later the whole span is populated, so leaving it open
      // lets a *later* transaction push an *earlier* one over the threshold: a crossing the live
      // rule never saw, and an id it never issued.
      // `isEligibleCrossing` has already established priceDefinitionAllowedDate is set.
      const spanEnd = Util.daysAfter(VOLUME_WINDOW_DAYS, tx.created);
      const dateTo = tx.priceDefinitionAllowedDate < spanEnd ? tx.priceDefinitionAllowedDate : spanEnd;

      const previousVolume = await this.transactionHelper.getVolumeSince(
        Util.daysBefore(VOLUME_WINDOW_DAYS, tx.created),
        dateTo,
        users,
        tx,
      );
      const volume = previousVolume + tx.amountInChf;

      if (volume > threshold)
        return {
          userDataId,
          // The verdict timestamp, not `created`. Live, `amlListAddedDate` is stamped at assignment
          // — which happens in the same tick as the verdict — so this is the closest proxy. Using
          // `created` would also misfile a transaction created in one year and approved in the
          // next, since `getKycFileYearlyStats` buckets on exactly this column.
          crossingDate: tx.priceDefinitionAllowedDate,
          crossingTxId: tx.id,
          crossingTxType:
            tx instanceof BuyCrypto ? TransactionTypeInternal.BUY_CRYPTO : TransactionTypeInternal.BUY_FIAT,
          volumeAtCrossing: Util.round(volume, 2),
        };
    }

    return null;
  }

  /**
   * Narrows to what `isEligibleCrossing` accepts, so the scan does not pull a candidate's entire
   * history over the wire. The predicate stays authoritative; this is an optimisation.
   *
   * Filters the same column the predicate does. Filtering `created` here instead would not merely
   * be a looser superset — it narrows on a *different axis*, dropping exactly the transactions the
   * predicate exists to admit (created before the outage, held in review until inside it). The
   * crossing would then fall to a later transaction and the compliance date would be wrong rather
   * than absent.
   *
   * Bounded on both sides, unlike the volume behind each candidate: the span legitimately reaches
   * outside the window, exactly as the live rule did.
   */
  private async loadWindowTransactions(userIds: number[]): Promise<(BuyCrypto | BuyFiat)[]> {
    const inWindow = {
      amlCheck: CheckStatus.PASS,
      priceDefinitionAllowedDate: Between(AFFECTED_WINDOW_START, AFFECTED_WINDOW_END),
    };

    const [buyCryptos, buyFiats] = await Promise.all([
      this.buyCryptoRepo.find({
        where: [
          { buy: { user: { id: In(userIds) } }, ...inWindow },
          { cryptoRoute: { user: { id: In(userIds) } }, ...inWindow },
        ],
        relations: { cryptoInput: true },
        loadEagerRelations: false,
      }),
      this.buyFiatRepo.find({
        where: { sell: { user: { id: In(userIds) } }, ...inWindow },
        relations: { cryptoInput: true },
        loadEagerRelations: false,
      }),
    ]);

    return [...buyCryptos, ...buyFiats].sort((a, b) => a.created.getTime() - b.created.getTime());
  }

  /**
   * Assigns the next free id, or returns null when the row already has one — a concurrent live AML
   * tick or an overlapping run got there first, and the conditional UPDATE makes that a no-op
   * rather than an overwrite.
   *
   * The audit entry is written *before* the column changes and carries both the previous and the
   * next value, per CONTRIBUTING's before→after rule: if the log write fails the row is left
   * alone. That ordering matters here because the UPDATE also touches `amlListAddedDate`, which a
   * row can legitimately already carry with a null `kycFileId` (a merge copies the slave's date
   * across, and compliance can set it directly) — so the write is potentially destructive and the
   * prior value has to be recoverable from the log alone.
   *
   * Only the UPDATE is retried, so a downstream failure can never hand the row a second id.
   */
  private async assign(crossing: Crossing, attempt = 0): Promise<number | null> {
    const before = await this.userDataRepo.findOne({
      where: { id: crossing.userDataId },
      select: { id: true, kycFileId: true, amlListAddedDate: true },
      loadEagerRelations: false,
    });
    if (!before || before.kycFileId != null) return null;

    const kycFileId = await this.userDataService.getNextKycFileId();

    // Never clear a date the row already carries: the live rule only ever set this alongside a
    // fresh id, so an existing value came from somewhere else and is not ours to overwrite.
    const amlListAddedDate = before.amlListAddedDate ?? crossing.crossingDate;

    // Logged per attempt, not once: a retry re-allocates, so a single entry written on the first
    // attempt would name an id the row never receives. The cost is an entry for an attempt that
    // then fails or no-ops — which is the direction CONTRIBUTING's fail-closed rule prefers, since
    // the alternative is a mutation with no audit trail at all.
    await this.writeLog(crossing, before, { kycFileId, amlListAddedDate }, attempt);

    try {
      const { affected } = await this.userDataRepo.update(
        { id: crossing.userDataId, kycFileId: IsNull() },
        { kycFileId, amlListAddedDate },
      );

      return affected ? kycFileId : null;
    } catch (e) {
      // `update()` goes straight to the driver, so a unique-index collision surfaces as
      // QueryFailedError — not the ConflictException that `updateUserDataInternal` would raise.
      const isConflict = e.message?.includes('duplicate key');
      if (attempt >= MAX_ASSIGNMENT_ATTEMPTS - 1 || !isConflict) throw e;

      return this.assign(crossing, attempt + 1);
    }
  }

  private async writeLog(
    crossing: Crossing,
    before: UserData,
    next: { kycFileId: number; amlListAddedDate: Date },
    attempt: number,
  ): Promise<void> {
    const previous = `kycFileId ${before.kycFileId ?? 'null'}, amlListAddedDate ${
      before.amlListAddedDate?.toISOString() ?? 'null'
    }`;
    const applied = `kycFileId ${next.kycFileId}, amlListAddedDate ${next.amlListAddedDate.toISOString()}`;
    const retry = attempt > 0 ? ` (retry ${attempt}, previous attempt lost the id to a concurrent write)` : '';

    await this.kycLogService.createLogInternal(
      before,
      KycLogType.KYC,
      `Backfill (#4041): ${previous} -> ${applied}${retry}. Crossing ${crossing.crossingTxType} ` +
        `${crossing.crossingTxId} at ${crossing.crossingDate.toISOString()}, ${crossing.volumeAtCrossing} CHF.`,
    );
  }
}
