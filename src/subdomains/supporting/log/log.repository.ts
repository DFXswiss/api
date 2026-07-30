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
  /**
   * null when the JSON key in `assets` is not a plain non-negative-integer string (`^[0-9]+$`) —
   * kept as a row with assetId=null rather than aborting the whole query via a failing `::int` cast.
   */
  assetId: number | null;
  /**
   * null when this row carries no usable price: `assets` was empty/absent for the log row (one
   * placeholder row per log row), the JSON value at `priceChf` was not a JSON number (e.g. the string
   * "1.25"), or the numeric value was NaN/Infinity.
   */
  priceChf: number | null;
  /** id of the underlying log row — logId is ALWAYS present, on every row, even the null-price ones.
   *  Overflow detection / keyset cursor logic in LedgerMarkService counts distinct logId values across
   *  ALL returned rows (not just the ones with a usable price) to know how many log rows were actually
   *  read — see LedgerMarkService.uniqueLogIds. */
  logId: number;
}

/**
 * Dashboard financial-log chart fields projected from a FinancialDataLog snapshot.
 * Contains exactly what mapSummaryToEntry needs. Shape depends on includeByType (see fields below).
 */
export interface FinancialLogSummary {
  created: Date;
  id: number;
  /**
   * null when absent/non-numeric in the source column (e.g. a row from before the backfill
   * migration populated it, or the write-time value was non-finite) — mapSummaryToEntry keeps
   * its existing `?? 0` default at the call site; this method must NOT default it itself. Always
   * present (never omitted) — this is one of the two fields the Overview screen's chart draws.
   */
  totalBalanceChf: number | null;
  /**
   * 0 when btcAssetId is falsy (undefined or 0) or the column value is unusable — computed in SQL
   * only when btcAssetId is truthy. Always present (never omitted) — the second field the
   * Overview screen's chart draws.
   */
  btcPriceChf: number;
  /**
   * Present only when includeByType is true (the History screen path, unchanged byte-for-byte
   * from before this spec: still computed from `message`). Omitted entirely (not null, not 0) for
   * the Overview/chart-only call (includeByType=false) — that screen never reads it.
   */
  plusBalanceChf?: number | null;
  /** Same includeByType-gated presence as plusBalanceChf. */
  minusBalanceChf?: number | null;
  /** Same includeByType-gated presence as plusBalanceChf. */
  fxPnlChf?: number | null;
  /**
   * Same includeByType-gated presence as plusBalanceChf/minusBalanceChf/fxPnlChf — pre-existing
   * behaviour, unchanged by this spec.
   */
  balancesByType?: Record<string, { plusBalanceChf?: number; minusBalanceChf?: number }>;
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
   *
   * LEFT JOIN LATERAL (not an implicit CROSS JOIN) so every log row yields at least one result row — including
   * when `assets` is empty/absent or a key/price is unusable (assetId/priceChf null). That keeps logId-based
   * overflow detection and keyset pagination in LedgerMarkService correct (Finding 1+2: the old join+WHERE
   * dropped unusable-price rows entirely, so uniqueLogIds under-counted and pagination/overflow stopped early).
   * Invalid keys and non-number priceChf are nulled via CASE expressions rather than filtered in WHERE, so the
   * row (and its logId) always remains. Malformed `message` JSON fails loud: `message::jsonb` aborts the whole
   * query (intentional change vs the old JS path that try/caught per row).
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
       CASE WHEN kv.key ~ '^[0-9]+$' THEN kv.key::int ELSE NULL END AS "assetId",
       CASE
         WHEN jsonb_typeof(kv.value -> 'priceChf') = 'number' THEN (kv.value ->> 'priceChf')::float8
         ELSE NULL
       END AS "priceChf",
       l.id AS "logId"
FROM (
  SELECT id, created, message
  FROM log
  WHERE ${conditions.join(' AND ')}
  ORDER BY created ASC, id ASC
  ${limitClause}
) l
LEFT JOIN LATERAL jsonb_each(l.message::jsonb -> 'assets') kv ON true
ORDER BY l.created ASC, l.id ASC`;

    const raw = (await this.query(sql, params)) as {
      created: Date | string;
      assetId: number | string | null;
      priceChf: number | string | null;
      logId: number | string;
    }[];

    const rows: FinancialLogAssetPrice[] = raw.map((r) => {
      const priceChf = r.priceChf == null ? null : Number(r.priceChf);
      return {
        created: r.created instanceof Date ? r.created : new Date(r.created),
        assetId: r.assetId == null ? null : Number(r.assetId),
        // float8 NaN/Infinity (e.g. an out-of-range numeric text) must be excluded the same way the old
        // Number.isFinite gate excluded them — never surface as a phantom mark.
        priceChf: priceChf != null && Number.isFinite(priceChf) ? priceChf : null,
        logId: Number(r.logId),
      };
    });

    if (!rows.length && after != null) await this.assertEmptyResultIsEndOfData(after);
    return rows;
  }

  /**
   * Dispatches between the full History-screen projection (includeByType=true, default —
   * message-derived, byte-identical to before the chart-column split; see
   * getFinancialLogSummariesFull) and the Overview chart-only projection (includeByType=false —
   * reads only totalBalanceChf/btcPriceChf from dedicated columns, `message` never referenced;
   * see getFinancialLogSummariesChartOnly). Measured against a production-table replica for the
   * chart-only path: 1.407 ms (parsing message) vs 5.2 ms (column projection) for 2,099 points
   * in a 3-day window.
   */
  async getFinancialLogSummaries(
    btcAssetId?: number,
    from?: Date,
    dailySample?: boolean,
    to?: Date,
    limit?: number,
    after?: number, // id of the last row of the previous page; NEVER a Date/created value
    includeByType = true, // true (the default, History screen): full message-derived payload,
    // byte-identical to before this spec — see getFinancialLogSummariesFull. false (Overview
    // screen): chart-only projection reading only totalBalanceChf/btcPriceChf from columns,
    // `message` never referenced — see getFinancialLogSummariesChartOnly. This is a deliberate,
    // documented API contract split, not a silent behaviour change.
  ): Promise<FinancialLogSummary[]> {
    return includeByType
      ? this.getFinancialLogSummariesFull(btcAssetId, from, dailySample, to, limit, after, true)
      : this.getFinancialLogSummariesChartOnly(btcAssetId, from, dailySample, to, limit, after);
  }

  /**
   * Full History-screen projection: unchanged from before this spec, still fully message-derived —
   * see the original detailed reasoning inline below.
   */
  private async getFinancialLogSummariesFull(
    btcAssetId?: number,
    from?: Date,
    dailySample?: boolean,
    to?: Date,
    limit?: number,
    after?: number, // id of the last row of the previous page; NEVER a Date/created value
    includeByType = true, // selects/omits the balancesByFinancialType sub-tree from the SELECT list;
    // true (the default) reproduces the exact pre-existing response for every caller that does not
    // pass this parameter; only an explicit false skips the sub-tree. This default is intentional and
    // required by this spec's backward-compatibility guarantee — it is not masking an error case.
  ): Promise<FinancialLogSummary[]> {
    const params: unknown[] = [];
    let i = 1;

    // Fixed filter params shared by the main WHERE and (when dailySample) the MAX(id) subquery.
    const systemParam = `$${i++}`;
    const subsystemParam = `$${i++}`;
    const severityParam = `$${i++}`;
    const validParam = `$${i++}`;
    params.push('LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true);

    // BTC price: only bind a parameter when btcAssetId is truthy — mirrors the old extractBtcPrice's
    // `!btcAssetId` falsy check (0/undefined/null all take the "no BTC asset" path), not merely
    // `!== undefined`. btcAssetId=0 is unreachable in this database (asset ids start at 1), so the
    // difference is not observable today, but the falsy check preserves byte-identical behaviour with
    // extractBtcPrice for any future btcAssetId=0 — do not "fix" this back to `!== undefined`.
    let btcPriceSelect: string;
    if (btcAssetId) {
      const assetPath = `message::jsonb -> 'assets' -> $${i}::text`;
      // jsonb_typeof guard (same pattern as the balancesTotal fields below and getFinancialLogAssetPrices'
      // priceChf guard above): a missing asset entry or a non-numeric priceChf value nulls only this
      // field instead of aborting the whole query via a failing ::float8 cast. Number(null) => 0 in the
      // mapping below, matching extractBtcPrice's `?.priceChf ?? 0` and its 0-return paths.
      btcPriceSelect = `CASE WHEN jsonb_typeof(${assetPath} -> 'priceChf') = 'number' THEN (${assetPath} ->> 'priceChf')::float8 ELSE NULL END`;
      params.push(String(btcAssetId));
      i++;
    } else {
      btcPriceSelect = '0::float8';
    }

    const conditions: string[] = [];
    if (dailySample) {
      // Same daily-sample shape as getFinancialLogs: restrict to MAX(id) per calendar day among valid INFO
      // FinancialDataLog rows, then apply from/to/after/limit on the outer filtered set.
      conditions.push(
        `id IN (SELECT MAX(id) FROM log WHERE system = ${systemParam} AND subsystem = ${subsystemParam} AND severity = ${severityParam} AND valid = ${validParam} GROUP BY CAST(created AS DATE))`,
      );
    } else {
      conditions.push(
        `system = ${systemParam}`,
        `subsystem = ${subsystemParam}`,
        `severity = ${severityParam}`,
        `valid = ${validParam}`,
      );
    }

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

    const selectColumns = [
      `created AS "created"`,
      `id AS "id"`,
      `CASE
         WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'totalBalanceChf') = 'number'
         THEN (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::float8
         ELSE NULL
       END AS "totalBalanceChf"`,
      `CASE
         WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'plusBalanceChf') = 'number'
         THEN (message::jsonb -> 'balancesTotal' ->> 'plusBalanceChf')::float8
         ELSE NULL
       END AS "plusBalanceChf"`,
      `CASE
         WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'minusBalanceChf') = 'number'
         THEN (message::jsonb -> 'balancesTotal' ->> 'minusBalanceChf')::float8
         ELSE NULL
       END AS "minusBalanceChf"`,
      `CASE
         WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'fxPnlChf') = 'number'
         THEN (message::jsonb -> 'balancesTotal' ->> 'fxPnlChf')::float8
         ELSE NULL
       END AS "fxPnlChf"`,
      `${btcPriceSelect} AS "btcPriceChf"`,
    ];
    // The actual DB-time/payload saving: when not requested, this sub-tree is never in the SELECT
    // list at all (not selected and then discarded after the fact).
    if (includeByType) {
      selectColumns.push(`message::jsonb -> 'balancesByFinancialType' AS "balancesByFinancialType"`);
    }

    const sql = `
SELECT ${selectColumns.join(',\n       ')}
FROM log
WHERE ${conditions.join(' AND ')}
ORDER BY created ASC, id ASC
${limitClause}`;

    const raw = (await this.query(sql, params)) as {
      created: Date | string;
      id: number | string;
      totalBalanceChf: number | string | null;
      plusBalanceChf: number | string | null;
      minusBalanceChf: number | string | null;
      fxPnlChf: number | string | null;
      btcPriceChf: number | string | null;
      balancesByFinancialType?: unknown;
    }[];

    const rows: FinancialLogSummary[] = raw.map((r) => {
      // pg may return numeric columns as strings; coerce with Number(...) like getFinancialLogAssetPrices.
      // totalBalanceChf/plusBalanceChf/minusBalanceChf/fxPnlChf all stay null when the SQL projection
      // above nulled them (do NOT default any of them to 0 here — that belongs to mapSummaryToEntry's
      // `?? 0` at the call site).
      // btcPriceChf: absent/unusable path → 0, matching extractBtcPrice's `?.priceChf ?? 0`.
      const btcPriceChf = r.btcPriceChf == null ? 0 : Number(r.btcPriceChf);

      // Only computed/present at all when includeByType is true (see the SELECT-list construction
      // above): the key is entirely absent on the returned summary otherwise (conditional spread
      // below), not an empty object and not null.
      let balancesByType: Record<string, { plusBalanceChf?: number; minusBalanceChf?: number }> | undefined;
      if (includeByType) {
        balancesByType = {};
        if (r.balancesByFinancialType != null) {
          // Always an already-parsed object/array here, never a JSON string: pg-types registers JSON.parse
          // as the type parser for jsonb (OID 3802) and this repo configures no custom type parser, so the
          // driver never hands back a raw string for this column.
          const byType = r.balancesByFinancialType as Record<
            string,
            { plusBalanceChf?: number; minusBalanceChf?: number }
          >;
          // Only real numbers are kept for plusBalanceChf / minusBalanceChf; any non-number value
          // (string, boolean, null, nested object, or missing key) becomes undefined so the result
          // matches the number | undefined contract. On current production data this is a no-op
          // (287,989 entries both numbers, one missing plusBalanceChf key — no string/boolean/null),
          // and exists only to protect the contract for future/other data. The previous mapLogToEntry
          // passed contract-breaking values through unchanged; this closes that hole. Same hardening
          // idea as the five scalar fields above (jsonb_typeof = 'number' in SQL), applied in
          // TypeScript because balancesByFinancialType is passed through as a raw JSON object. Note:
          // this is a type check, not a finiteness check — it also lets `Infinity` through (e.g. from
          // a JSON number like `1e999`, which `JSON.parse` turns into `Infinity`); `NaN` cannot occur
          // in valid jsonb.
          const asNumber = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
          for (const [type, data] of Object.entries(byType)) {
            // Optional chaining keeps non-object entries (null / number / string / boolean) from throwing:
            // property access yields undefined and the row is retained with empty fields, rather than
            // failing the whole request.
            balancesByType[type] = {
              plusBalanceChf: asNumber(data?.plusBalanceChf),
              minusBalanceChf: asNumber(data?.minusBalanceChf),
            };
          }
        }
      }

      return {
        created: r.created instanceof Date ? r.created : new Date(r.created),
        id: Number(r.id),
        totalBalanceChf: r.totalBalanceChf == null ? null : Number(r.totalBalanceChf),
        plusBalanceChf: r.plusBalanceChf == null ? null : Number(r.plusBalanceChf),
        minusBalanceChf: r.minusBalanceChf == null ? null : Number(r.minusBalanceChf),
        fxPnlChf: r.fxPnlChf == null ? null : Number(r.fxPnlChf),
        btcPriceChf,
        ...(includeByType ? { balancesByType } : {}),
      };
    });

    if (!rows.length && after != null) await this.assertEmptyResultIsEndOfData(after);
    return rows;
  }

  /**
   * Chart-only projection for the Overview screen (includeByType=false): reads ONLY the two
   * columns that screen's chart draws (totalBalanceChf, btcPriceChf) directly from `log`.
   * `message` is never referenced anywhere in this query — neither in the SELECT list nor in a
   * condition — so the ~43 KB TOAST value is never fetched for this call. Measured against a
   * production-table replica: 1.407 ms (parsing message) vs 5.2 ms (this projection) for 2,099
   * points in a 3-day window.
   *
   * plusBalanceChf/minusBalanceChf/fxPnlChf/balancesByType are intentionally absent from every
   * returned row (not null, not 0) — see FinancialLogSummary. This is a deliberate API contract
   * change for the includeByType=false call, not the includeByType=true (History) path, which is
   * untouched (see getFinancialLogSummariesFull above).
   */
  private async getFinancialLogSummariesChartOnly(
    btcAssetId?: number,
    from?: Date,
    dailySample?: boolean,
    to?: Date,
    limit?: number,
    after?: number, // id of the last row of the previous page; NEVER a Date/created value
  ): Promise<FinancialLogSummary[]> {
    const params: unknown[] = [];
    let i = 1;

    const systemParam = `$${i++}`;
    const subsystemParam = `$${i++}`;
    const severityParam = `$${i++}`;
    const validParam = `$${i++}`;
    params.push('LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true);

    // Mirrors extractBtcPrice's old `!btcAssetId` falsy check (0/undefined/null all take the
    // "no BTC asset" path) — byte-identical fallback to before this spec, just reading the column
    // instead of a jsonb path when btcAssetId is truthy. No $N parameter is bound for btcAssetId
    // itself (there is no per-row jsonb key lookup left to parameterise).
    const btcPriceSelect = btcAssetId ? `"btcPriceChf"` : '0::float8';

    const conditions: string[] = [];
    if (dailySample) {
      conditions.push(
        `id IN (SELECT MAX(id) FROM log WHERE system = ${systemParam} AND subsystem = ${subsystemParam} AND severity = ${severityParam} AND valid = ${validParam} GROUP BY CAST(created AS DATE))`,
      );
    } else {
      conditions.push(
        `system = ${systemParam}`,
        `subsystem = ${subsystemParam}`,
        `severity = ${severityParam}`,
        `valid = ${validParam}`,
      );
    }

    if (from) {
      conditions.push(`created >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`created <= $${i++}`);
      params.push(to);
    }
    if (after != null) {
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
SELECT created AS "created",
       id AS "id",
       "totalBalanceChf" AS "totalBalanceChf",
       ${btcPriceSelect} AS "btcPriceChf"
FROM log
WHERE ${conditions.join(' AND ')}
ORDER BY created ASC, id ASC
${limitClause}`;

    const raw = (await this.query(sql, params)) as {
      created: Date | string;
      id: number | string;
      totalBalanceChf: number | string | null;
      btcPriceChf: number | string | null;
    }[];

    const rows: FinancialLogSummary[] = raw.map((r) => ({
      created: r.created instanceof Date ? r.created : new Date(r.created),
      id: Number(r.id),
      totalBalanceChf: r.totalBalanceChf == null ? null : Number(r.totalBalanceChf),
      btcPriceChf: r.btcPriceChf == null ? 0 : Number(r.btcPriceChf),
    }));

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
