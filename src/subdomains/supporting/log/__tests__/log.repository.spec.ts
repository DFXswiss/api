import { EntityManager, UpdateResult } from 'typeorm';
import { FINANCIAL_DATA_LOG_SUBSYSTEM, FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM, LogSeverity } from '../log.entity';
import { LogRepository } from '../log.repository';

type UpdateQueryBuilderStub = {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  execute: jest.Mock;
};

type FinancialLogQueryBuilderStub = {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  groupBy: jest.Mock;
  limit: jest.Mock;
  take: jest.Mock;
  select: jest.Mock;
  setParameters: jest.Mock;
  getQuery: jest.Mock;
  getParameters: jest.Mock;
  getExists: jest.Mock;
  getMany: jest.Mock;
};

// Minimal chainable stub for the update query builder: every condition call returns itself, and
// execute() reports how many rows the batch touched.
function updateQueryBuilderStub(affected: number | null | undefined): UpdateQueryBuilderStub {
  const builder: UpdateQueryBuilderStub = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected } as UpdateResult),
  };

  return builder;
}

// Chainable stub for the main getFinancialLogs query path (getMany) and the post-empty cursor guard (getExists).
// Same stub instance serves both createQueryBuilder calls; getExists is only consulted after an empty main result.
function financialLogQueryBuilderStub(exists: boolean): FinancialLogQueryBuilderStub {
  const builder: FinancialLogQueryBuilderStub = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue(''),
    getParameters: jest.fn().mockReturnValue({}),
    getExists: jest.fn().mockResolvedValue(exists),
    getMany: jest.fn().mockResolvedValue([]),
  };

  return builder;
}

describe('LogRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new LogRepository({} as EntityManager);

    expect(repo).toBeInstanceOf(LogRepository);
  });

  describe('cleanup', () => {
    it('never deletes financial log validity audit records', async () => {
      const repo = new LogRepository({} as EntityManager);
      const queryBuilderSpy = jest.spyOn(repo, 'createQueryBuilder');
      const deleteSpy = jest.spyOn(repo, 'delete');

      await repo.cleanup({
        system: 'LogService',
        subsystem: FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
        saveDays: 1,
        keepOnePerDay: false,
      });

      expect(queryBuilderSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('setFinancialLogValidity', () => {
    const dto = { valid: false, from: new Date('2026-06-18'), reference: 'ticket SUP-123' };

    it('updates the audited ids in batches of 100 and sums the affected counts', async () => {
      const repo = new LogRepository({} as EntityManager);
      const builders = [updateQueryBuilderStub(100), updateQueryBuilderStub(100), updateQueryBuilderStub(50)];
      let call = 0;
      const queryBuilderSpy = jest
        .spyOn(repo, 'createQueryBuilder')
        .mockImplementation(() => builders[call++] as never);

      const ids = Array.from({ length: 250 }, (_, index) => index + 1);
      const affected = await repo.setFinancialLogValidity(dto, ids);

      expect(affected).toBe(250);
      expect(queryBuilderSpy).toHaveBeenCalledTimes(3);
      expect(builders.map((b) => b.execute.mock.calls.length)).toEqual([1, 1, 1]);

      // Every batch binds its own id slice, so the update can never exceed the audited set.
      const boundIds = builders.map(
        (b) =>
          (b.andWhere.mock.calls.find(([condition]) => condition === 'id IN (:...ids)')?.[1] as { ids: number[] }).ids,
      );
      expect(boundIds.map((b) => b.length)).toEqual([100, 100, 50]);
      expect(boundIds.flat()).toEqual(ids);
    });

    it('throws when a batch reports no affected count instead of silently summing NaN', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(updateQueryBuilderStub(undefined) as never);

      await expect(repo.setFinancialLogValidity(dto, [11, 12])).rejects.toThrow(
        'Financial log validity update returned no affected count',
      );
    });
  });

  describe('getFinancialLogs cursor guard', () => {
    it('fails loud when the keyset cursor id no longer exists (no silent empty main query)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const stub = financialLogQueryBuilderStub(false);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogs(undefined, false, undefined, undefined, 999)).rejects.toThrow(
        'Financial log cursor row 999 no longer exists',
      );

      // Main query runs first; guard only after empty result + set after.
      expect(stub.getMany).toHaveBeenCalled();
      expect(stub.getExists).toHaveBeenCalled();
    });

    it('returns empty when the cursor still exists (legitimate end-of-data)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const stub = financialLogQueryBuilderStub(true);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogs(undefined, false, undefined, undefined, 999)).resolves.toEqual([]);

      expect(stub.getMany).toHaveBeenCalled();
      expect(stub.getExists).toHaveBeenCalled();
    });

    it('skips the existence check when after is unset', async () => {
      const repo = new LogRepository({} as EntityManager);
      const stub = financialLogQueryBuilderStub(false);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogs(undefined, false)).resolves.toEqual([]);

      expect(stub.getMany).toHaveBeenCalled();
      expect(stub.getExists).not.toHaveBeenCalled();
    });

    it('skips the existence check when the main query returns rows', async () => {
      const repo = new LogRepository({} as EntityManager);
      const stub = financialLogQueryBuilderStub(false);
      const page = [{ id: 1 } as never];
      stub.getMany.mockResolvedValueOnce(page);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogs(undefined, false, undefined, undefined, 999)).resolves.toBe(page);

      expect(stub.getMany).toHaveBeenCalled();
      expect(stub.getExists).not.toHaveBeenCalled();
    });

    it('fails loud on the dailySample path when the cursor id no longer exists', async () => {
      const repo = new LogRepository({} as EntityManager);
      const stub = financialLogQueryBuilderStub(false);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogs(undefined, true, undefined, undefined, 999)).rejects.toThrow(
        'Financial log cursor row 999 no longer exists',
      );

      expect(stub.getMany).toHaveBeenCalled();
      expect(stub.getExists).toHaveBeenCalled();
    });
  });

  describe('getFinancialLogSummaries', () => {
    it('maps the SQL projection into FinancialLogSummary (numbers, balancesByType, btc price)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const created = new Date('2026-07-14T00:00:00Z');
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created,
          id: '42',
          totalBalanceChf: '100.5',
          plusBalanceChf: '200',
          minusBalanceChf: '99.5',
          fxPnlChf: '-3245',
          btcPriceChf: '65000.25',
          balancesByFinancialType: {
            // Real jsonb-embedded numbers already arrive as JS numbers via the pg driver — no Number()
            // coercion happens in this loop anymore (F10), so the mock must reflect that shape.
            Crypto: { plusBalanceChf: 10, minusBalanceChf: 5, plusBalance: 1, minusBalance: 1 },
            Fiat: { plusBalanceChf: 90, minusBalanceChf: 40 },
          },
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(7);

      expect(rows).toEqual([
        {
          created,
          id: 42,
          totalBalanceChf: 100.5,
          plusBalanceChf: 200,
          minusBalanceChf: 99.5,
          fxPnlChf: -3245,
          btcPriceChf: 65000.25,
          balancesByType: {
            Crypto: { plusBalanceChf: 10, minusBalanceChf: 5 },
            Fiat: { plusBalanceChf: 90, minusBalanceChf: 40 },
          },
        },
      ]);
      // Projection must use distinct plus/minus columns (mutation: swap would fail this assertion).
      expect(rows[0].plusBalanceChf).not.toBe(rows[0].minusBalanceChf);
      expect(rows[0].balancesByType.Crypto.plusBalanceChf).toBe(10);
      expect(rows[0].balancesByType.Crypto.minusBalanceChf).toBe(5);

      const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
      // Exact path→alias bindings: swapping plus/minus (or hard-coding btc) in the projection must fail.
      // jsonb_typeof guards (F2/F3) wrap each cast; the path→alias pairing is still asserted.
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'totalBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::float8`);
      expect(sql).toContain(`END AS "totalBalanceChf"`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'plusBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'plusBalanceChf')::float8`);
      expect(sql).toContain(`END AS "plusBalanceChf"`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'minusBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'minusBalanceChf')::float8`);
      expect(sql).toContain(`END AS "minusBalanceChf"`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'assets' -> $5::text -> 'priceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'assets' -> $5::text ->> 'priceChf')::float8`);
      expect(sql).toContain(`AS "btcPriceChf"`);
      expect(sql).toContain(`message::jsonb -> 'balancesByFinancialType' AS "balancesByFinancialType"`);
      expect(sql).not.toContain("-> 'tradings'");
      expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, '7']);
    });

    it('projects btcPriceChf as SQL literal 0 when btcAssetId is undefined (no assets path param)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 1,
          plusBalanceChf: 1,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: 0,
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(undefined);

      expect(rows[0].btcPriceChf).toBe(0);
      expect(rows[0].fxPnlChf).toBeNull();
      expect(rows[0].balancesByType).toEqual({});
      const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('0::float8');
      expect(sql).not.toContain("-> 'assets'");
      expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true]);
    });

    it('defaults absent btc priceChf from SQL null to 0 in the mapping layer', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 1,
          plusBalanceChf: 1,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: null,
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(99);
      expect(rows[0].btcPriceChf).toBe(0);
    });

    it('uses the dailySample MAX(id)-per-day subquery when dailySample is true', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

      await repo.getFinancialLogSummaries(undefined, undefined, true);

      const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('MAX(id)');
      expect(sql).toContain('CAST(created AS DATE)');
      expect(sql).toContain('id IN (');
    });

    it('fails loud when the keyset cursor id no longer exists (no silent empty main query)', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'query').mockResolvedValue([]);
      const stub = financialLogQueryBuilderStub(false);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(
        repo.getFinancialLogSummaries(undefined, undefined, false, undefined, undefined, 999),
      ).rejects.toThrow('Financial log cursor row 999 no longer exists');

      expect(stub.getExists).toHaveBeenCalled();
    });

    it('returns empty when the cursor still exists (legitimate end-of-data)', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'query').mockResolvedValue([]);
      const stub = financialLogQueryBuilderStub(true);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(
        repo.getFinancialLogSummaries(undefined, undefined, false, undefined, undefined, 999),
      ).resolves.toEqual([]);

      expect(stub.getExists).toHaveBeenCalled();
    });

    it('skips the existence check when after is unset', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'query').mockResolvedValue([]);
      const stub = financialLogQueryBuilderStub(false);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);

      await expect(repo.getFinancialLogSummaries()).resolves.toEqual([]);

      expect(stub.getExists).not.toHaveBeenCalled();
    });

    it('binds from/to/limit/after as incremental parameters after the fixed filters', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);
      const stub = financialLogQueryBuilderStub(true);
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(stub as never);
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-02-01T00:00:00Z');

      await repo.getFinancialLogSummaries(3, from, false, to, 50, 10);

      const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('created >=');
      expect(sql).toContain('created <=');
      expect(sql).toContain('(created, id) >');
      expect(sql).toContain('LIMIT');
      expect(params).toEqual([
        'LogService',
        FINANCIAL_DATA_LOG_SUBSYSTEM,
        LogSeverity.INFO,
        true,
        '3',
        from,
        to,
        10,
        10,
        50,
      ]);
    });

    it('orders by created ASC, id ASC (never DESC) so the chart stays chronological and keyset pagination advances forward', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

      await repo.getFinancialLogSummaries();

      const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ORDER BY created ASC, id ASC');
    });

    describe('parameter position ($N placeholders match their array index)', () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-02-01T00:00:00Z');

      it('only from, btcAssetId set', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

        await repo.getFinancialLogSummaries(7, from);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('$5::text');
        expect(sql).toContain('created >= $6');
        expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, '7', from]);
      });

      it('from + to, btcAssetId set', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

        await repo.getFinancialLogSummaries(7, from, false, to);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('created >= $6');
        expect(sql).toContain('created <= $7');
        expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, '7', from, to]);
      });

      it('from + limit, btcAssetId set, dailySample true', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

        await repo.getFinancialLogSummaries(7, from, true, undefined, 50);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('created >= $6');
        expect(sql).toContain('LIMIT $7');
        expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, '7', from, 50]);
      });

      it('from + after + limit, btcAssetId set', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);
        jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(financialLogQueryBuilderStub(true) as never);

        await repo.getFinancialLogSummaries(7, from, false, undefined, 50, 10);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('created >= $6');
        expect(sql).toContain('(created, id) > ((SELECT c.created FROM log c WHERE c.id = $7), $8)');
        expect(sql).toContain('LIMIT $9');
        expect(params).toEqual([
          'LogService',
          FINANCIAL_DATA_LOG_SUBSYSTEM,
          LogSeverity.INFO,
          true,
          '7',
          from,
          10,
          10,
          50,
        ]);
      });

      it('none of from/to/after/limit, btcAssetId set', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

        await repo.getFinancialLogSummaries(7);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('$5::text');
        expect(sql).not.toContain('created >=');
        expect(sql).not.toContain('created <=');
        expect(sql).not.toContain('(created, id) >');
        expect(sql).not.toContain('LIMIT');
        expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, '7']);
      });

      it('btcAssetId undefined, from + after', async () => {
        const repo = new LogRepository({} as EntityManager);
        const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);
        jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(financialLogQueryBuilderStub(true) as never);

        await repo.getFinancialLogSummaries(undefined, from, false, undefined, undefined, 10);

        const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('0::float8');
        expect(sql).toContain('created >= $5');
        expect(sql).toContain('(created, id) > ((SELECT c.created FROM log c WHERE c.id = $6), $7)');
        expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true, from, 10, 10]);
      });
    });

    it('guards all five projected number fields with jsonb_typeof so one bad value nulls only that field (F2/F3)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([]);

      await repo.getFinancialLogSummaries(7);

      const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'totalBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::float8`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'plusBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'plusBalanceChf')::float8`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'minusBalanceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'minusBalanceChf')::float8`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'balancesTotal' -> 'fxPnlChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'balancesTotal' ->> 'fxPnlChf')::float8`);
      expect(sql).toContain(`WHEN jsonb_typeof(message::jsonb -> 'assets' -> $5::text -> 'priceChf') = 'number'`);
      expect(sql).toContain(`THEN (message::jsonb -> 'assets' -> $5::text ->> 'priceChf')::float8`);
    });

    it('projects btcPriceChf as SQL literal 0 when btcAssetId is 0 — same falsy branch as undefined (F1)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 1,
          plusBalanceChf: 1,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: 0,
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(0);

      expect(rows[0].btcPriceChf).toBe(0);
      const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('0::float8');
      expect(sql).not.toContain(`-> 'assets'`);
      expect(params).toEqual(['LogService', FINANCIAL_DATA_LOG_SUBSYSTEM, LogSeverity.INFO, true]);
    });

    it('maps a raw row where balancesTotal is entirely missing (all guards fire) to null/null/null (not 0) and keeps fxPnlChf null — the ?? 0 default happens only in mapSummaryToEntry, never in the repository (F13)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const created = new Date('2026-07-14T00:00:00Z');
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created,
          id: 1,
          totalBalanceChf: null,
          plusBalanceChf: null,
          minusBalanceChf: null,
          fxPnlChf: null,
          btcPriceChf: '65000.25',
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(7);

      expect(rows[0].totalBalanceChf).toBeNull();
      expect(rows[0].plusBalanceChf).toBeNull();
      expect(rows[0].minusBalanceChf).toBeNull();
      expect(rows[0].fxPnlChf).toBeNull();
      expect(rows[0].btcPriceChf).toBe(65000.25);
    });

    // This raw shape is what the SQL projection produces for a top-level `message: null` JSON
    // document. The old mapLogToEntry/JSON.parse path threw on the resulting property access and
    // dropped the whole line for this case; not observed in production. The btcPriceChf null-to-0
    // default is applied entirely in getFinancialLogSummaries, so this repository-level test already
    // covers it (expects btcPriceChf to be 0). Null pass-through for the other number fields
    // (totalBalanceChf, plusBalanceChf, minusBalanceChf, fxPnlChf) is left to the call site and is
    // covered separately at the service layer by the mapSummaryToEntry test that defaults null
    // totalBalanceChf/plusBalanceChf/minusBalanceChf to 0.
    it('keeps the row and passes all number fields through as null, sets btcPriceChf to 0, and returns balancesByType as an empty object for a raw row where all projected number fields and balancesByFinancialType are null (F20b)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const created = new Date('2026-07-14T00:00:00Z');
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created,
          id: 3,
          // Same raw shape the SQL projection produces for a top-level JSON `null` message: every
          // `jsonb_typeof(message::jsonb -> ...)` guard sees a non-object/non-number operand and nulls
          // its field, same as a missing key.
          totalBalanceChf: null,
          plusBalanceChf: null,
          minusBalanceChf: null,
          fxPnlChf: null,
          btcPriceChf: null,
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(7);

      expect(rows).toHaveLength(1);
      expect(rows[0].totalBalanceChf).toBeNull();
      expect(rows[0].plusBalanceChf).toBeNull();
      expect(rows[0].minusBalanceChf).toBeNull();
      expect(rows[0].fxPnlChf).toBeNull();
      expect(rows[0].btcPriceChf).toBe(0);
      expect(rows[0].balancesByType).toEqual({});
    });

    it('maps a raw row with JSON null for only totalBalanceChf/plusBalanceChf (minusBalanceChf/fxPnlChf unaffected) to null/null, not 0 (F13)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const created = new Date('2026-07-14T00:00:00Z');
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created,
          id: 2,
          totalBalanceChf: null,
          plusBalanceChf: null,
          minusBalanceChf: '500',
          fxPnlChf: '-12.5',
          btcPriceChf: '65000.25',
          balancesByFinancialType: null,
        },
      ]);

      const rows = await repo.getFinancialLogSummaries(7);

      expect(rows[0].totalBalanceChf).toBeNull();
      expect(rows[0].plusBalanceChf).toBeNull();
      expect(rows[0].minusBalanceChf).toBe(500);
      expect(rows[0].fxPnlChf).toBe(-12.5);
      expect(rows[0].btcPriceChf).toBe(65000.25);
    });

    it('passes plusBalanceChf through unconverted when the key is missing from one balancesByFinancialType entry, instead of Number(undefined) => NaN => null (F10, matches a real production row)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const created = new Date('2026-07-14T00:00:00Z');
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created,
          id: 99,
          totalBalanceChf: 100,
          plusBalanceChf: 100,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: 0,
          balancesByFinancialType: {
            Crypto: { minusBalanceChf: 5 }, // plusBalanceChf key missing, as observed in production
          },
        },
      ]);

      const rows = await repo.getFinancialLogSummaries();

      expect(rows[0].balancesByType.Crypto.plusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Crypto.minusBalanceChf).toBe(5);
      // The old mapLogToEntry omitted the key entirely for a missing value; JSON serialisation drops an
      // undefined-valued key the same way — never NaN, never null.
      expect(JSON.parse(JSON.stringify(rows[0].balancesByType.Crypto))).toEqual({ minusBalanceChf: 5 });
    });

    it('keeps the row and yields undefined fields (not 0, not null, no error) when a balancesByFinancialType entry is null, a number, or a string (F16 reverts the F11 throw)', async () => {
      const repo = new LogRepository({} as EntityManager);
      const querySpy = jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 77,
          totalBalanceChf: 100,
          plusBalanceChf: 100,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: 0,
          balancesByFinancialType: { Crypto: null, Fiat: 1, Other: 'bad' },
        },
      ]);

      const rows = await repo.getFinancialLogSummaries();

      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].balancesByType.Crypto.plusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Crypto.minusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Fiat.plusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Fiat.minusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Other.plusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Other.minusBalanceChf).toBeUndefined();
      // Same JSON-serialisation check as the F10 test: undefined values are omitted, never null/0.
      expect(JSON.parse(JSON.stringify(rows[0].balancesByType))).toEqual({ Crypto: {}, Fiat: {}, Other: {} });
    });

    it('yields undefined for both fields (no error, row kept) when a balancesByFinancialType entry is an object but its properties have the wrong type (string/boolean)', async () => {
      const repo = new LogRepository({} as EntityManager);
      jest.spyOn(repo, 'query').mockResolvedValue([
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 88,
          totalBalanceChf: 100,
          plusBalanceChf: 100,
          minusBalanceChf: 0,
          fxPnlChf: null,
          btcPriceChf: 0,
          balancesByFinancialType: {
            Crypto: { plusBalanceChf: 'bad', minusBalanceChf: true },
          },
        },
      ]);

      const rows = await repo.getFinancialLogSummaries();

      expect(rows).toHaveLength(1);
      expect(rows[0].balancesByType.Crypto.plusBalanceChf).toBeUndefined();
      expect(rows[0].balancesByType.Crypto.minusBalanceChf).toBeUndefined();
      // Wrong-typed values become undefined and are dropped on serialisation — never null/0/string/boolean.
      expect(JSON.parse(JSON.stringify(rows[0].balancesByType.Crypto))).toEqual({});
    });
  });
});
