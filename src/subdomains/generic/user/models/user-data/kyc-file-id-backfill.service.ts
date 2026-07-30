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

// Matches the live AML volume window in both preparation services:
// Util.daysBefore(30, tx.created) … Util.daysAfter(30, tx.created).
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
  skipped: number;
  sample: Crossing[];
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
 * volume window (±30d) and its inclusion rule (`amlCheck != FAIL`) match by construction. Note
 * that the rule for selecting the crossing transaction itself is narrower — see
 * `loadWindowTransactions`. The transaction's own contribution uses the stored `amountInChf`, the
 * value priced at AML time, rather than re-pricing at today's rate.
 *
 * The first transaction whose volume exceeds `monthlyDefaultWoKyc` is the crossing; its `created`
 * becomes `amlListAddedDate`, so `getKycFileYearlyStats` keeps the per-year shape it would have
 * had. Crossings are assigned oldest-first so ids stay monotonic with time.
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
    const candidateIds = await this.findCandidateIds();

    this.logger.info(`Backfill starting: ${candidateIds.length} candidates (dryRun=${options.dryRun})`);

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
      sample: crossings.slice(0, 20),
      dryRun: options.dryRun,
    };

    if (options.dryRun) return report;

    for (const crossing of crossings) {
      try {
        const kycFileId = await this.assign(crossing);

        if (kycFileId == null) {
          report.skipped++;
          continue;
        }

        report.assigned++;
        await this.writeLog(crossing, kycFileId);
      } catch (e) {
        this.logger.error(`Backfill failed for userData ${crossing.userDataId}:`, e);
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
  private async findCandidateIds(): Promise<number[]> {
    const window = { from: AFFECTED_WINDOW_START, to: AFFECTED_WINDOW_END };

    const [fromBuyCrypto, fromBuyFiat] = await Promise.all([
      this.buyCryptoRepo
        .createQueryBuilder('bc')
        .leftJoin('bc.buy', 'buy')
        .leftJoin('bc.cryptoRoute', 'cryptoRoute')
        .leftJoin('buy.user', 'buyUser')
        .leftJoin('cryptoRoute.user', 'routeUser')
        .select('COALESCE(buyUser.userDataId, routeUser.userDataId)', 'userDataId')
        .where('bc.amlCheck != :fail', { fail: CheckStatus.FAIL })
        .andWhere('bc.created >= :from', window)
        .andWhere('bc.created < :to', window)
        .groupBy('COALESCE(buyUser.userDataId, routeUser.userDataId)')
        .getRawMany<{ userDataId: number | null }>(),
      this.buyFiatRepo
        .createQueryBuilder('bf')
        .leftJoin('bf.sell', 'sell')
        .leftJoin('sell.user', 'sellUser')
        .select('sellUser.userDataId', 'userDataId')
        .where('bf.amlCheck != :fail', { fail: CheckStatus.FAIL })
        .andWhere('bf.created >= :from', window)
        .andWhere('bf.created < :to', window)
        .groupBy('sellUser.userDataId')
        .getRawMany<{ userDataId: number | null }>(),
    ]);

    const withTx = [...fromBuyCrypto, ...fromBuyFiat].map((r) => r.userDataId).filter((id): id is number => id != null);
    if (!withTx.length) return [];

    const candidates = await this.userDataRepo.find({
      where: { id: In([...new Set(withTx)]), kycFileId: IsNull(), status: Not(UserDataStatus.MERGED) },
      select: { id: true },
    });

    return candidates.map((c) => c.id);
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
    return (
      tx.amlCheck === CheckStatus.PASS &&
      tx.created >= AFFECTED_WINDOW_START &&
      tx.created < AFFECTED_WINDOW_END &&
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

      const previousVolume = await this.transactionHelper.getVolumeSince(
        Util.daysBefore(VOLUME_WINDOW_DAYS, tx.created),
        Util.daysAfter(VOLUME_WINDOW_DAYS, tx.created),
        users,
        tx,
      );
      const volume = previousVolume + tx.amountInChf;

      if (volume > threshold)
        return {
          userDataId,
          crossingDate: tx.created,
          crossingTxId: tx.id,
          crossingTxType:
            tx instanceof BuyCrypto ? TransactionTypeInternal.BUY_CRYPTO : TransactionTypeInternal.BUY_FIAT,
          volumeAtCrossing: Util.round(volume, 2),
        };
    }

    return null;
  }

  /**
   * Narrows to roughly what `isEligibleCrossing` accepts, so the scan does not pull a candidate's
   * entire history over the wire. The predicate stays authoritative; this is an optimisation.
   *
   * Bounded on both sides, unlike the volume behind each candidate: `getVolumeSince` spans its own
   * ±30d and legitimately reaches outside the window, exactly as the live rule did.
   */
  private async loadWindowTransactions(userIds: number[]): Promise<(BuyCrypto | BuyFiat)[]> {
    const inWindow = {
      amlCheck: CheckStatus.PASS,
      created: Between(AFFECTED_WINDOW_START, AFFECTED_WINDOW_END),
    };

    const [buyCryptos, buyFiats] = await Promise.all([
      this.buyCryptoRepo.find({
        where: [
          { buy: { user: { id: In(userIds) } }, ...inWindow },
          { cryptoRoute: { user: { id: In(userIds) } }, ...inWindow },
        ],
        relations: { cryptoInput: true },
      }),
      this.buyFiatRepo.find({
        where: { sell: { user: { id: In(userIds) } }, ...inWindow },
        relations: { cryptoInput: true },
      }),
    ]);

    return [...buyCryptos, ...buyFiats].sort((a, b) => a.created.getTime() - b.created.getTime());
  }

  /**
   * Assigns the next free id, or returns null when the row already has one — a concurrent live AML
   * tick or an overlapping run got there first, and the conditional UPDATE makes that a no-op
   * rather than an overwrite. Only the UPDATE is retried, so nothing downstream can re-assign.
   */
  private async assign(crossing: Crossing, attempt = 0): Promise<number | null> {
    const last = await this.userDataRepo.findOne({
      where: { kycFileId: Not(IsNull()) },
      order: { kycFileId: 'DESC' },
    });
    const kycFileId = (last?.kycFileId ?? 0) + 1;

    try {
      const { affected } = await this.userDataRepo.update(
        { id: crossing.userDataId, kycFileId: IsNull() },
        { kycFileId, amlListAddedDate: crossing.crossingDate },
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

  /** Written only after the assignment has committed: a failure here must not hand out a second id. */
  private async writeLog(crossing: Crossing, kycFileId: number): Promise<void> {
    await this.kycLogService.createLogInternal(
      Object.assign(new UserData(), { id: crossing.userDataId }),
      KycLogType.KYC,
      `Backfilled kycFileId ${kycFileId}, amlListAddedDate ${crossing.crossingDate.toISOString()} ` +
        `(crossing ${crossing.crossingTxType} ${crossing.crossingTxId}, ${crossing.volumeAtCrossing} CHF).`,
    );
  }
}
