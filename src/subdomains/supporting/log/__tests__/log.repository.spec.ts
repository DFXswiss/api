import { EntityManager, UpdateResult } from 'typeorm';
import { FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM } from '../log.entity';
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
});
