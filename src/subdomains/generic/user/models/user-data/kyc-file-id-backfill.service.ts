import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
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
import { UserService } from '../user/user.service';
import { UserData } from './user-data.entity';
import { UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

// Floor for both the candidate scan and the crossing computation. Set to the InitialSchema
// migration timestamp rather than the psql cutover commit (2026-05-22): this is a `>=` pre-filter,
// so the earliest point Postgres could have been serving is the safe bound. Earlier crossings
// cannot have been lost — on MSSQL the assignment succeeded, so those rows carry a kycFileId and
// are excluded by the `kycFileId IS NULL` candidate filter regardless.
const AFFECTED_WINDOW_START = new Date('2026-05-18T00:00:00Z');

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
 * while `getLastKycFileId()` returned a NULLS-FIRST null. Background in PR #4041.
 *
 * Reproduces the live rule rather than approximating it: per-transaction volume comes from
 * `TransactionHelper.getVolumeSince`, the same call `aml.service.postProcessing` is fed by, so the
 * window (±30d around the transaction) and the inclusion rule (`amlCheck != FAIL`) match by
 * construction. The transaction's own contribution uses the stored `amountInChf` — the value
 * priced at AML time — rather than re-pricing at today's rate.
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

  async run(options: BackfillOptions): Promise<BackfillReport> {
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
   * the row. Anyone who could have crossed has at least one non-FAIL transaction in the window.
   */
  private async findCandidateIds(): Promise<number[]> {
    const [fromBuyCrypto, fromBuyFiat] = await Promise.all([
      this.buyCryptoRepo
        .createQueryBuilder('bc')
        .leftJoin('bc.buy', 'buy')
        .leftJoin('bc.cryptoRoute', 'cryptoRoute')
        .leftJoin('buy.user', 'buyUser')
        .leftJoin('cryptoRoute.user', 'routeUser')
        .select('COALESCE(buyUser.userDataId, routeUser.userDataId)', 'userDataId')
        .where('bc.amlCheck != :fail', { fail: CheckStatus.FAIL })
        .andWhere('bc.created >= :from', { from: AFFECTED_WINDOW_START })
        .groupBy('COALESCE(buyUser.userDataId, routeUser.userDataId)')
        .getRawMany<{ userDataId: number | null }>(),
      this.buyFiatRepo
        .createQueryBuilder('bf')
        .leftJoin('bf.sell', 'sell')
        .leftJoin('sell.user', 'sellUser')
        .select('sellUser.userDataId', 'userDataId')
        .where('bf.amlCheck != :fail', { fail: CheckStatus.FAIL })
        .andWhere('bf.created >= :from', { from: AFFECTED_WINDOW_START })
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
   * Walks the candidate's in-window transactions oldest-first and returns the first whose volume —
   * computed by the same helper the live AML flow uses — exceeds the threshold.
   */
  private async computeCrossing(userDataId: number, threshold: number): Promise<Crossing | null> {
    const users = await this.userService.getAllUserDataUsers(userDataId);
    if (!users.length) return null;

    const txs = await this.loadWindowTransactions(users.map((u) => u.id));

    for (const tx of txs) {
      // Payment pay-ins never trigger the assignment (aml.service.postProcessing).
      if (tx.cryptoInput?.txType === PayInType.PAYMENT) continue;
      if (tx.amountInChf == null) continue;

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
   * Only in-window transactions are candidates for being *the* crossing — earlier ones cannot have
   * lost an assignment. The volume behind each candidate is not floored the same way:
   * `getVolumeSince` spans its own ±30d and legitimately reaches back before the window, exactly
   * as the live rule did.
   */
  private async loadWindowTransactions(userIds: number[]): Promise<(BuyCrypto | BuyFiat)[]> {
    const inWindow = { amlCheck: Not(CheckStatus.FAIL), created: MoreThanOrEqual(AFFECTED_WINDOW_START) };

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
      const isConflict = e instanceof ConflictException || e.message?.includes('duplicate key');
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
