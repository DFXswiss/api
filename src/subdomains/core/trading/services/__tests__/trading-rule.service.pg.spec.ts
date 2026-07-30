import { createMock } from '@golevelup/ts-jest';
import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';
import { TradingRuleService } from '../trading-rule.service';
import { TradingService } from '../trading.service';

// the real TradingOrder / TradingRule entities cannot be registered standalone (relations pull
// in the whole entity graph), so these tables mirror only the columns the rewritten
// getCurrentTradingOrders query actually touches — under the real table names
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
}

// runs getCurrentTradingOrders against a Postgres-semantics engine (pg-mem), because the
// correctness of the rewrite is the SQL shape (per-rule MAX + In(...)), not a mocked query
// builder that never executes
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

  it('returns the highest-id order per rule, skips empty rules and orphans, and matches the pre-rewrite aggregate', async () => {
    await seedFixture();

    const result = await service.getCurrentTradingOrders();
    const resultIds = result.map((order) => order.id).sort((a, b) => a - b);

    // concrete ids per rule (fails if MAX is swapped for MIN or any wrong pick)
    expect(resultIds).toEqual([30, 40]);
    expect(result).toHaveLength(2);
    expect(result.some((order) => order.id === 10 || order.id === 20)).toBe(false);
    expect(result.some((order) => order.id === 99)).toBe(false);

    // independently reproduce the CURRENT (pre-rewrite) aggregate against the same seeded tables
    const legacyRows = await dataSource
      .getRepository(TradingOrderTable)
      .createQueryBuilder('tradingOrder')
      .select('MAX(tradingOrder.id)', 'tradingOrderId')
      .innerJoin(TradingRuleTable, 'tradingRule', 'tradingRule.id = tradingOrder.tradingRuleId')
      .groupBy('tradingOrder.tradingRuleId')
      .getRawMany<{ tradingOrderId: number }>();

    const legacyIds = legacyRows.map((row) => Number(row.tradingOrderId)).sort((a, b) => a - b);
    expect(resultIds).toEqual(legacyIds);
  });
});
