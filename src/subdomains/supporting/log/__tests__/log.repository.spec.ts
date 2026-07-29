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
            Crypto: { plusBalanceChf: '10', minusBalanceChf: '5', plusBalance: 1, minusBalance: 1 },
            Fiat: { plusBalanceChf: '90', minusBalanceChf: '40' },
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
      expect(sql).toContain(
        `(message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::float8 AS "totalBalanceChf"`,
      );
      expect(sql).toContain(
        `(message::jsonb -> 'balancesTotal' ->> 'plusBalanceChf')::float8 AS "plusBalanceChf"`,
      );
      expect(sql).toContain(
        `(message::jsonb -> 'balancesTotal' ->> 'minusBalanceChf')::float8 AS "minusBalanceChf"`,
      );
      expect(sql).toContain(`(message::jsonb -> 'assets' -> $5::text ->> 'priceChf')::float8 AS "btcPriceChf"`);
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
  });
});
