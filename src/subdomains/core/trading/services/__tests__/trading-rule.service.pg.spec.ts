import { createMock } from '@golevelup/ts-jest';
import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, FindOperator, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TradingRuleService } from '../trading-rule.service';
import { TradingService } from '../trading.service';

// the real TradingOrder / TradingRule entities cannot be registered standalone (relations pull
// in the whole entity graph), so these tables mirror only the columns getCurrentTradingOrders
// actually touches — under the real table names
@Entity({ name: 'trading_rule' })
class TradingRuleTable {
  @PrimaryColumn()
  id: number;
}

@Entity({ name: 'trading_order' })
class TradingOrderTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'int' })
  tradingRuleId: number;

  // Relation path for `.innerJoin('tradingOrder.tradingRule', ...)`; createForeignKeyConstraints
  // is false so the intentionally orphaned fixture row (tradingRuleId with no matching rule) stays insertable.
  @ManyToOne(() => TradingRuleTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'tradingRuleId' })
  tradingRule: TradingRuleTable;
}

// runs getCurrentTradingOrders against a Postgres-semantics engine (pg-mem) to verify the
// aggregation semantics, because a mocked query builder never executes SQL and a wrong shape
// (e.g. MAX swapped for MIN, or the INNER JOIN removed) would otherwise go unnoticed
describe('TradingRuleService.getCurrentTradingOrders (postgres semantics)', () => {
  let dataSource: DataSource;
  let service: TradingRuleService;

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [TradingRuleTable, TradingOrderTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(TradingOrderTable).clear();
    await dataSource.getRepository(TradingRuleTable).clear();

    const tradingService = createMock<TradingService>();
    service = new TradingRuleService(tradingService);
    (service as any).orderRepo = dataSource.getRepository(TradingOrderTable);
    (service as any).ruleRepo = dataSource.getRepository(TradingRuleTable);
  });

  async function seedFixture(): Promise<void> {
    const ruleRepo = dataSource.getRepository(TradingRuleTable);
    const orderRepo = dataSource.getRepository(TradingOrderTable);

    // rule 1: several orders → expect max id 30
    // rule 2: exactly one order → expect id 40
    // rule 3: no orders → must not appear
    // orphan order 99: tradingRuleId matches no rule → must not appear (INNER JOIN exclusion)
    await ruleRepo.save([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await orderRepo.save([
      { id: 10, tradingRuleId: 1 },
      { id: 20, tradingRuleId: 1 },
      { id: 30, tradingRuleId: 1 },
      { id: 40, tradingRuleId: 2 },
      { id: 99, tradingRuleId: 999 },
    ]);
  }

  it('returns the highest-id order per rule, skips empty rules and orphans', async () => {
    await seedFixture();

    const result = await service.getCurrentTradingOrders();
    const resultIds = result.map((order) => order.id).sort((a, b) => a - b);

    // concrete ids per rule (fails if MAX is swapped for MIN or any wrong pick)
    expect(resultIds).toEqual([30, 40]);
    expect(result).toHaveLength(2);
    expect(result.some((order) => order.id === 10 || order.id === 20)).toBe(false);
    expect(result.some((order) => order.id === 99)).toBe(false);
  });

  it('returns an empty array when trading_rule is empty', async () => {
    const result = await service.getCurrentTradingOrders();

    expect(result).toEqual([]);
  });

  it('never passes null or undefined order ids into findBy In(...)', async () => {
    await dataSource.getRepository(TradingRuleTable).save([{ id: 1 }, { id: 2 }]);
    await dataSource.getRepository(TradingOrderTable).save([
      { id: 10, tradingRuleId: 1 },
      { id: 20, tradingRuleId: 1 },
    ]);

    const findBySpy = jest.spyOn(service['orderRepo'], 'findBy');
    try {
      await service.getCurrentTradingOrders();

      expect(findBySpy).toHaveBeenCalled();
      const findByArg = findBySpy.mock.calls[0][0];

      // findBy accepts a single condition or an array of them; getCurrentTradingOrders only ever
      // passes a single { id: In(...) } condition, so an array here would itself be a regression.
      if (Array.isArray(findByArg)) {
        throw new Error('expected findBy to receive a single FindOptionsWhere condition, not an array of them');
      }

      const idCondition = findByArg.id;

      // In(...) produces a real TypeORM FindOperator instance. A bare value would slip past the
      // array check below, so reject it here. This does not pin the operator to In specifically:
      // Any(), Not() and friends are FindOperator instances too, and swapping In for Any would
      // carry the same list of ids -- which is what this test is actually about.
      if (!(idCondition instanceof FindOperator)) {
        throw new Error(`expected findBy id condition to be a FindOperator, got: ${String(idCondition)}`);
      }

      // FindOperator<T>.value is typed against the entity's own field type (number here), but
      // In(...) stores the full array as the operator's underlying value. Widen through the real
      // FindOperator class -- not an invented shape -- to read it without lying about its declared
      // element type; unknown is the one legitimate single-step escape hatch for this widening.
      const idValues = (idCondition as FindOperator<unknown>).value;
      if (!Array.isArray(idValues)) {
        throw new Error('expected the FindOperator to carry an array of ids');
      }

      expect(idValues.every((id) => id !== null && id !== undefined)).toBe(true);
    } finally {
      findBySpy.mockRestore();
    }
  });
});
