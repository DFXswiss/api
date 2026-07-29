import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import {
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  SelectQueryBuilder,
  UpdateQueryBuilder,
} from 'typeorm';
import { LogCleanupSetting } from './dto/create-log.dto';
import { SetFinancialLogValidityDto } from './dto/set-financial-log-validity.dto';
import {
  FINANCIAL_DATA_LOG_SUBSYSTEM,
  FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
  Log,
  LogSeverity,
  MAX_VALIDITY_SWEEP_ROWS,
} from './log.entity';

/** One asset priceChf projected from a FinancialDataLog snapshot (no full message JSON). */
export interface FinancialLogAssetPrice {
  created: Date;
  assetId: number;
  priceChf: number;
  /** id of the underlying log row — keyset cursor / overflow counts use this, not result-row index. */
  logId: number;
}

@Injectable()
export class LogRepository extends BaseRepository<Log> {
  constructor(manager: EntityManager) {
    super(Log, manager);
  }

  async cleanup(logCleanupSetting: LogCleanupSetting): Promise<void> {
    // Auditable mutations: audit records must remain recoverable and are never eligible for generic cleanup.
    if (logCleanupSetting.subsystem === FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM) return;

    const system = logCleanupSetting.system;
    const subsystem = logCleanupSetting.subsystem;
    const saveDays = logCleanupSetting.saveDays;

    const saveDate = Util.daysBefore(saveDays);
    saveDate.setHours(0, 0, 0, 0);

    let query = this.createQueryBuilder('log')
      .select('log.id', 'log_id')
      .where('log.system=:system', { system })
      .andWhere('log.subsystem=:subsystem', { subsystem })
      .andWhere('log.created<:saveDate', { saveDate });

    if (logCleanupSetting.keepOnePerDay) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system=log.system')
        .andWhere('subLog.subsystem=log.subsystem')
        .groupBy('CAST(subLog.created as DATE)');

      query = query.andWhere(`log.id NOT IN (${subQuery.getQuery()})`);
    }

    const logIdsToBeDeleted = await query.getRawMany<{ log_id: number }>().then((i) => i.map((i) => i.log_id));

    await Util.doInBatches(logIdsToBeDeleted, async (batch: number[]) => this.delete(batch), 100);
  }

  async getFinancialLogAt(targetDate: Date, direction: 'before' | 'after'): Promise<Log | undefined> {
    return this.findOne({
      where: {
        system: 'LogService',
        subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM,
        severity: LogSeverity.INFO,
        created: direction === 'before' ? LessThanOrEqual(targetDate) : MoreThanOrEqual(targetDate),
      },
      order: { created: direction === 'before' ? 'DESC' : 'ASC' },
    });
  }

  // Unfiltered: exposes the exact newest snapshot for numeric balance displays.
  async getLatestFinancialLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM, severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  // The last `count` VALID FinancialDataLog snapshots, newest first. Used by the ledger equity-parity check to build
  // a median baseline that is robust against the transient ±snapshot-skew spikes the FinancialDataLog carries
  // (valid=false spikes are already excluded here); see BalancesTotal (log.dto.ts, case 4).
  async getLatestValidFinancialLogs(count: number): Promise<Log[]> {
    return this.find({
      where: { system: 'LogService', subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM, severity: LogSeverity.INFO, valid: true },
      order: { id: 'DESC' },
      take: count,
    });
  }

  async getLatestFinancialChangesLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: 'FinancialChangesLog', severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  async getFinancialChangesLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    if (dailySample) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem: 'FinancialChangesLog' })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO })
        .groupBy('CAST(subLog.created AS DATE)');

      let query = this.createQueryBuilder('log')
        .where(`log.id IN (${subQuery.getQuery()})`)
        .setParameters(subQuery.getParameters())
        .orderBy('log.created', 'ASC');

      if (from) {
        query = query.andWhere('log.created >= :from', { from });
      }

      return query.getMany();
    }

    const where: FindOptionsWhere<Log> = {
      system: 'LogService',
      subsystem: 'FinancialChangesLog',
      severity: LogSeverity.INFO,
    };

    if (from) {
      where.created = MoreThanOrEqual(from);
    }

    return this.find({ where, order: { created: 'ASC' } });
  }

  // Filters valid = true so chart series skip spike/glitch snapshots; use getLatestFinancialLog for exact numeric values.
  // Optional `after` keyset cursor is the id of the last row of the previous page (never a Date / created value).
  // Ordering remains (created ASC, id ASC); the cursor comparison is a Postgres row-value `(created, id) > (...)`
  // where `created` for `:afterId` is resolved in a correlated subquery at full timestamp(6) microsecond precision.
  // That avoids round-tripping `created` through JS `Date` (ms only), which would truncate and re-include the cursor row.
  // Main query runs first. Only when it returns empty with a set `after` does assertEmptyResultIsEndOfData run: a
  // deleted cursor id would make the subquery NULL and the WHERE exclude every row, which callers would misread as
  // end-of-data. Non-empty pages skip the existence check (no extra round-trip).
  async getFinancialLogs(
    from?: Date,
    dailySample?: boolean,
    to?: Date,
    limit?: number,
    after?: number, // id of the last row of the previous page; NEVER a Date/created value
  ): Promise<Log[]> {
    if (dailySample) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO })
        .andWhere('subLog.valid = :valid', { valid: true })
        .groupBy('CAST(subLog.created AS DATE)');

      let query = this.createQueryBuilder('log')
        .where(`log.id IN (${subQuery.getQuery()})`)
        .setParameters(subQuery.getParameters())
        .orderBy('log.created', 'ASC')
        .addOrderBy('log.id', 'ASC');

      if (from) {
        query = query.andWhere('log.created >= :from', { from });
      }
      if (to) {
        query = query.andWhere('log.created <= :to', { to });
      }
      if (after != null) {
        // Row-value compare; subquery resolves created at full DB precision so JS Date truncation cannot re-include
        // the cursor row. Empty results with a set after are checked via assertEmptyResultIsEndOfData below.
        query = query.andWhere(
          '(log.created, log.id) > ((SELECT c.created FROM log c WHERE c.id = :afterId), :afterId)',
          { afterId: after },
        );
      }
      if (limit != null) {
        query = query.limit(limit);
      }

      const rows = await query.getMany();
      if (!rows.length && after != null) await this.assertEmptyResultIsEndOfData(after);
      return rows;
    }

    // QueryBuilder (not find/FindOptionsWhere): the row-value keyset on (created, id) cannot be expressed cleanly otherwise.
    let query = this.createQueryBuilder('log')
      .where('log.system = :system', { system: 'LogService' })
      .andWhere('log.subsystem = :subsystem', { subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM })
      .andWhere('log.severity = :severity', { severity: LogSeverity.INFO })
      .andWhere('log.valid = :valid', { valid: true })
      .orderBy('log.created', 'ASC')
      .addOrderBy('log.id', 'ASC');

    if (from && to) {
      query = query.andWhere('log.created >= :from AND log.created <= :to', { from, to });
    } else if (from) {
      query = query.andWhere('log.created >= :from', { from });
    } else if (to) {
      query = query.andWhere('log.created <= :to', { to });
    }

    if (after != null) {
      // Row-value compare; subquery resolves created at full DB precision so JS Date truncation cannot re-include
      // the cursor row. Empty results with a set after are checked via assertEmptyResultIsEndOfData below.
      query = query.andWhere(
        '(log.created, log.id) > ((SELECT c.created FROM log c WHERE c.id = :afterId), :afterId)',
        { afterId: after },
      );
    }

    if (limit != null) {
      query = query.take(limit);
    }

    const rows = await query.getMany();
    if (!rows.length && after != null) await this.assertEmptyResultIsEndOfData(after);
    return rows;
  }

  /**
   * SQL-side projection of priceChf per asset from FinancialDataLog snapshots.
   * LIMIT/keyset apply to log rows (inner subquery), not to the expanded asset result — same page semantics as
   * getFinancialLogs. Callers that only need marks avoid shipping/parsing the full message JSON.
   */
  async getFinancialLogAssetPrices(
    from?: Date,
    to?: Date,
    limit?: number,
    after?: number, // id of the last LOG row of the previous page; same cursor semantics as getFinancialLogs
  ): Promise<FinancialLogAssetPrice[]> {
    const params: unknown[] = [];
    let i = 1;
    const conditions = [`system = $${i++}`, `subsystem = $${i++}`, `severity = $${i++}`, `valid = $${i++}`];
    params.push('LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true);

    if (from) {
      conditions.push(`created >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`created <= $${i++}`);
      params.push(to);
    }
    if (after != null) {
      // Same row-value keyset as getFinancialLogs: created resolved in-DB at full precision.
      conditions.push(`(created, id) > ((SELECT c.created FROM log c WHERE c.id = $${i}), $${i + 1})`);
      params.push(after, after);
      i += 2;
    }

    let limitClause = '';
    if (limit != null) {
      limitClause = `LIMIT $${i++}`;
      params.push(limit);
    }

    const sql = `
SELECT l.created AS "created",
       (kv.key)::int AS "assetId",
       (kv.value->>'priceChf')::float8 AS "priceChf",
       l.id AS "logId"
FROM (
  SELECT id, created, message
  FROM log
  WHERE ${conditions.join(' AND ')}
  ORDER BY created ASC, id ASC
  ${limitClause}
) l,
LATERAL jsonb_each(l.message::jsonb -> 'assets') kv
WHERE kv.value->>'priceChf' IS NOT NULL
ORDER BY l.created ASC, l.id ASC`;

    const raw = (await this.query(sql, params)) as {
      created: Date | string;
      assetId: number | string;
      priceChf: number | string;
      logId: number | string;
    }[];

    const rows: FinancialLogAssetPrice[] = [];
    for (const r of raw) {
      const priceChf = Number(r.priceChf);
      if (!Number.isFinite(priceChf)) continue;

      rows.push({
        created: r.created instanceof Date ? r.created : new Date(r.created),
        assetId: Number(r.assetId),
        priceChf,
        logId: Number(r.logId),
      });
    }

    if (!rows.length && after != null) await this.assertEmptyResultIsEndOfData(after);
    return rows;
  }

  // After an empty main-query result with a keyset cursor, fail loud when the cursor id is gone: the row-value
  // subquery would return NULL and `(created, id) > (NULL, :afterId)` is NULL in Postgres → WHERE excludes every
  // row → silent empty result that callers misread as end-of-data. Only invoked when the main query already
  // returned empty (and `after` is set), so non-empty pages pay no extra round-trip. Prefer an explicit error
  // over that false EOF.
  private async assertEmptyResultIsEndOfData(afterId: number): Promise<void> {
    const exists = await this.createQueryBuilder('log').where('log.id = :afterId', { afterId }).getExists();
    if (!exists) throw new Error(`Financial log cursor row ${afterId} no longer exists`);
  }

  // Resolves the rows the update would change, locking them until the surrounding transaction
  // commits so their audited pre-state cannot go stale. Capped one above the sweep limit — that is
  // enough for the caller to detect an over-broad sweep without materialising the whole history.
  // Construct this repository on the transaction manager (new LogRepository(manager)) to enrol it.
  async getFinancialLogValidityChangeSet(
    dto: SetFinancialLogValidityDto,
  ): Promise<{ id: number; valid: boolean | null }[]> {
    const query = this.createQueryBuilder('log')
      .select(['log.id', 'log.valid'])
      .orderBy('log.id', 'ASC')
      .limit(MAX_VALIDITY_SWEEP_ROWS + 1)
      .setLock('pessimistic_write');
    this.addFinancialLogValidityConditions(query, dto);

    const logs = await query.getRawMany<{ log_id: number; log_valid: boolean | null }>();
    return logs.map(({ log_id, log_valid }) => {
      if (log_valid === undefined) throw new Error(`Missing validity value for financial log ${log_id}`);
      return { id: log_id, valid: log_valid };
    });
  }

  // Bulk-sets the valid flag on FinancialDataLog entries matched by an optional created range
  // ([from inclusive, to exclusive) — same half-open window as the daily migrations) and/or
  // totalBalanceChf bounds (min exclusive lower, max exclusive upper). Only rows whose current
  // valid differs are touched, so affected reflects actually-changed rows and re-runs are no-ops.
  // Restricted to the audited ids, so the updated set cannot exceed the set recorded in the audit.
  async setFinancialLogValidity(dto: SetFinancialLogValidityDto, ids: number[]): Promise<number> {
    const affected = await Util.doInBatches(
      ids,
      async (batch: number[]): Promise<number> => {
        const query = this.createQueryBuilder().update(Log).set({ valid: dto.valid });
        this.addFinancialLogValidityConditions(query, dto);
        query.andWhere('id IN (:...ids)', { ids: batch });

        const { affected: batchAffected } = await query.execute();
        if (batchAffected == null) throw new Error('Financial log validity update returned no affected count');

        return batchAffected;
      },
      100,
    );

    return Util.sum(affected);
  }

  private addFinancialLogValidityConditions(
    query: SelectQueryBuilder<Log> | UpdateQueryBuilder<Log>,
    dto: SetFinancialLogValidityDto,
  ): void {
    const balanceChf = `(CAST(message AS jsonb) -> 'balancesTotal' ->> 'totalBalanceChf')::numeric`;

    query
      .where('system = :system', { system: 'LogService' })
      .andWhere('subsystem = :subsystem', { subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM })
      .andWhere('severity = :severity', { severity: LogSeverity.INFO })
      .andWhere('valid IS DISTINCT FROM :targetValid', { targetValid: dto.valid });

    if (dto.from) query.andWhere('created >= :from', { from: dto.from });
    if (dto.to) query.andWhere('created < :to', { to: dto.to });
    if (dto.min != null) query.andWhere(`${balanceChf} > :min`, { min: dto.min });
    if (dto.max != null) query.andWhere(`${balanceChf} < :max`, { max: dto.max });
  }
}
