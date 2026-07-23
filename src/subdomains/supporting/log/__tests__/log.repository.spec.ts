import { EntityManager, UpdateResult } from 'typeorm';
import { FINANCIAL_DATA_LOG_SUBSYSTEM, FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM, LogSeverity } from '../log.entity';
import { LogRepository } from '../log.repository';

// Minimal chainable stub for the update query builder: every condition call returns itself, and
// execute() reports how many rows the batch touched.
function updateQueryBuilderStub(affected: number | null | undefined) {
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected } as UpdateResult),
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

  describe('getLatestFinancialLogs / getLatestValidFinancialLogs', () => {
    it('getLatestFinancialLogs queries FinancialDataLog INFO without a valid filter', async () => {
      const repo = new LogRepository({} as EntityManager);
      const findSpy = jest.spyOn(repo, 'find').mockResolvedValue([]);

      await repo.getLatestFinancialLogs(5);

      expect(findSpy).toHaveBeenCalledWith({
        where: { system: 'LogService', subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM, severity: LogSeverity.INFO },
        order: { id: 'DESC' },
        take: 5,
      });
    });

    it('getLatestValidFinancialLogs queries FinancialDataLog INFO with valid: true', async () => {
      const repo = new LogRepository({} as EntityManager);
      const findSpy = jest.spyOn(repo, 'find').mockResolvedValue([]);

      await repo.getLatestValidFinancialLogs(5);

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          system: 'LogService',
          subsystem: FINANCIAL_DATA_LOG_SUBSYSTEM,
          severity: LogSeverity.INFO,
          valid: true,
        },
        order: { id: 'DESC' },
        take: 5,
      });
    });
  });
});
