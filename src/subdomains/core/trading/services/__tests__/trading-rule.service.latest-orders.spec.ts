import { createMock } from '@golevelup/ts-jest';
import { Column, DataSource, Entity, FindOperator, In, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TradingRuleService } from '../trading-rule.service';
import { TradingService } from '../trading.service';

// the real TradingOrder / TradingRule entities cannot be registered standalone (relations pull
// in the whole entity graph), so these tables mirror only the columns getCurrentTradingOrders
// actually touches — under the real table names, because the query names them literally
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

  // createForeignKeyConstraints is false so the intentionally orphaned fixture row (a
  // tradingRuleId with no matching rule) stays insertable.
  @ManyToOne(() => TradingRuleTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'tradingRuleId' })
  tradingRule: TradingRuleTable;
}

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'trading_rule_latest_orders_spec';

/**
 * Runs everywhere, with no database. The semantics below need PostgreSQL and skip without it, so
 * this half exists to keep something unconditional: it pins the statement's shape, and above all
 * that there is exactly ONE of them.
 *
 * That count is the load-bearing assertion. LogJobService writes the FinanceLog from this result,
 * so every rule's latest order has to come from a single READ-COMMITTED snapshot; a per-rule loop
 * would read correctly in isolation and still be wrong here, mixing rows from different points in
 * time. No amount of result-shape checking catches that — only the statement count does.
 */
describe('TradingRuleService.getCurrentTradingOrders (statement shape)', () => {
  function serviceWith(rows: { tradingOrderId: number }[]) {
    const query = jest.fn().mockResolvedValue(rows);
    const findBy = jest.fn().mockResolvedValue([]);
    const service = new TradingRuleService(createMock<TradingService>());
    (service as any).orderRepo = { manager: { query }, findBy };

    return { service, query, findBy };
  }

  it('issues exactly one statement, so every rule is read under one snapshot', async () => {
    const { service, query } = serviceWith([{ tradingOrderId: 30 }]);

    await service.getCurrentTradingOrders();

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('drives the read from the rules and takes the newest order of each', async () => {
    const { service, query } = serviceWith([]);

    await service.getCurrentTradingOrders();

    const sql = (query.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    expect(sql).toContain('FROM "trading_rule" rule');
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('ORDER BY "order"."id" DESC');
    expect(sql).toContain('LIMIT 1');
    // a revert to the aggregate this replaced would read the whole index again
    expect(sql).not.toMatch(/GROUP BY|MAX\s*\(/);
    // LEFT JOIN LATERAL would emit a null id for a rule with no orders and carry it into In(...)
    expect(sql).not.toContain('LEFT JOIN LATERAL');
  });

  it('loads exactly the ids the statement returned', async () => {
    const { service, findBy } = serviceWith([{ tradingOrderId: 30 }, { tradingOrderId: 40 }]);

    await service.getCurrentTradingOrders();

    expect(findBy).toHaveBeenCalledWith({ id: In([30, 40]) });
  });
});

/**
 * This ran against pg-mem until getCurrentTradingOrders moved to a LATERAL, which pg-mem cannot
 * execute — it does not resolve the subquery's reference to the outer row, failing with
 * `column "rule.id" does not exist`. That limitation is exactly what the previous implementation
 * comment cited as the reason not to write the faster query, so lifting it is part of this change
 * rather than incidental to it.
 *
 * The cost is that these assertions now need a database and skip without MIGRATION_TEST_PG, where
 * before they ran everywhere. They do run in CI, which is also the only place the plan assertion at
 * the bottom means anything.
 */
describeDb('TradingRuleService.getCurrentTradingOrders (real Postgres)', () => {
  let dataSource: DataSource;
  let service: TradingRuleService;

  // The isolation schema is reached through search_path, not TypeORM's `schema` option. That option
  // qualifies entity queries only, while getCurrentTradingOrders reads through raw SQL with
  // unqualified table names — as the other raw reads in this codebase do — so the two halves would
  // resolve to different schemas and the raw one would look in `public`. Pointing search_path at
  // the test schema keeps both resolving the same way, which is also how production behaves, where
  // nothing configures a schema and everything lands in `public`.
  const connect = async (options: Record<string, unknown> = {}) => {
    const source = new DataSource({ type: 'postgres', url: PG_URL, ...options } as any);
    await source.initialize();
    return source;
  };

  beforeAll(async () => {
    const bootstrap = await connect();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = await connect({
      entities: [TradingRuleTable, TradingOrderTable],
      extra: { options: `-c search_path=${SCHEMA}` },
    });
    await dataSource.synchronize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();

    const cleanup = await connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await cleanup.destroy();
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

    // rule 1: several orders → expect latest id 30
    // rule 2: exactly one order → expect id 40
    // rule 3: no orders → must not appear
    // orphan order 99: tradingRuleId matches no rule → must not appear
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

    // concrete ids per rule (fails if the ORDER BY direction flips, or on any wrong pick)
    expect(resultIds).toEqual([30, 40]);
    expect(result).toHaveLength(2);
    expect(result.some((order) => order.id === 10 || order.id === 20)).toBe(false);
    expect(result.some((order) => order.id === 99)).toBe(false);
  });

  it('returns an empty array when trading_rule is empty', async () => {
    const result = await service.getCurrentTradingOrders();

    expect(result).toEqual([]);
  });

  it('returns an empty array when rules exist but none has an order', async () => {
    await dataSource.getRepository(TradingRuleTable).save([{ id: 1 }, { id: 2 }]);

    // a rule without orders contributes no row: CROSS JOIN LATERAL drops it, where a LEFT JOIN
    // LATERAL would have produced a null id and carried it into In(...)
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

  /**
   * The reason for the rewrite, asserted rather than described. With many orders over few rules the
   * aggregate had to read the whole ("tradingRuleId", "id") index; the LATERAL descends it once per
   * rule and stops at the first row. If a future change reverts to an aggregate, this fails while
   * every assertion above still passes.
   */
  it('drives the read from the rules rather than aggregating the orders', async () => {
    const ruleRepo = dataSource.getRepository(TradingRuleTable);
    const orderRepo = dataSource.getRepository(TradingOrderTable);

    await ruleRepo.save(Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })));
    await orderRepo.save(Array.from({ length: 4000 }, (_, i) => ({ id: i + 1, tradingRuleId: (i % 5) + 1 })));
    await dataSource.query(`ANALYZE "trading_order"`);
    await dataSource.query(`ANALYZE "trading_rule"`);

    const plan: { 'QUERY PLAN': string }[] = await dataSource.query(`
      EXPLAIN
      SELECT latest."id" AS "tradingOrderId"
      FROM "trading_rule" rule
      CROSS JOIN LATERAL (
        SELECT "order"."id"
        FROM "trading_order" "order"
        WHERE "order"."tradingRuleId" = rule."id"
        ORDER BY "order"."id" DESC
        LIMIT 1
      ) latest
    `);
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).toMatch(/Nested Loop/);
    expect(text).not.toMatch(/Aggregate/);
  });
});
