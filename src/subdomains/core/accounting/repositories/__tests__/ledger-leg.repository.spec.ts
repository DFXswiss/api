import { createMock } from '@golevelup/ts-jest';
import { EntityManager, SelectQueryBuilder } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { AccountType } from 'src/subdomains/core/accounting/entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import {
  LedgerLegRepository,
  SUSPENSE_LEG_PROJECTION,
} from 'src/subdomains/core/accounting/repositories/ledger-leg.repository';

describe('LedgerLegRepository', () => {
  let manager: EntityManager;
  let repository: LedgerLegRepository;

  beforeEach(() => {
    manager = createMock<EntityManager>();
    repository = new LedgerLegRepository(manager);
  });

  it('extends the shared BaseRepository', () => {
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('binds the injected EntityManager', () => {
    expect(repository.manager).toBe(manager);
  });

  it('manages the LedgerLeg entity', () => {
    expect(repository.target).toBe(LedgerLeg);
  });

  /**
   * The suspense query, asserted on the builder rather than on rows.
   *
   * What it selects is covered against a real database in
   * `subdomains/core/accounting/__tests__/ledger-suspense.projection.spec.ts`. Two properties are
   * not observable there and are asserted here instead: that both relations are joined as INNER
   * joins, and that the ordering is applied to the joined transaction. Both relations are
   * `nullable: false`, so an inner and a left join select the same rows today — a database test
   * cannot tell them apart, and the difference would surface only once that changed.
   */
  describe('findSuspenseLegs', () => {
    let calls: [string, unknown[]][];

    const argsOf = (method: string): unknown[][] => calls.filter(([name]) => name === method).map(([, args]) => args);

    beforeEach(() => {
      calls = [];

      const builder = new Proxy({} as SelectQueryBuilder<LedgerLeg>, {
        get: (_target, property: string) => {
          if (property === 'getMany') return () => Promise.resolve([]);
          return (...args: unknown[]) => {
            calls.push([property, args]);
            return builder;
          };
        },
      });

      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(builder);
    });

    it('joins the transaction and the account as inner joins', async () => {
      await repository.findSuspenseLegs();

      expect(argsOf('innerJoin')).toEqual([
        ['leg.tx', 'tx'],
        ['leg.account', 'account'],
      ]);
      // A left join here would widen the result set the moment either relation became nullable.
      expect(argsOf('leftJoin')).toEqual([]);
    });

    it('selects the projected fields together with their guards', async () => {
      await repository.findSuspenseLegs();

      expect(argsOf('select')).toEqual([[[...SUSPENSE_LEG_PROJECTION.fields, ...SUSPENSE_LEG_PROJECTION.guards]]]);
    });

    it('filters on suspense accounts and orders by the booking date of the transaction', async () => {
      await repository.findSuspenseLegs();

      expect(argsOf('where')).toEqual([['account.type = :type', { type: AccountType.SUSPENSE }]]);
      expect(argsOf('orderBy')).toEqual([['tx.bookingDate', 'ASC']]);
    });

    it('passes a reduced field list through, keeping the guards', async () => {
      // This is what the mutation test does: drop one response field, re-run the same query with
      // the rest of the projection intact.
      const reduced = SUSPENSE_LEG_PROJECTION.fields.filter((field) => field !== 'leg.amountChf');

      await repository.findSuspenseLegs(reduced);

      expect(argsOf('select')).toEqual([[[...reduced, ...SUSPENSE_LEG_PROJECTION.guards]]]);
    });
  });
});
