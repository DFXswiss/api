import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutService } from '../payout.service';

// the real PayoutOrder entity cannot be registered standalone (relations pull in the whole entity
// graph), so this table mirrors only the columns getPayoutOrderFee touches — under the real table name
@Entity({ name: 'payout_order' })
class PayoutOrderTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'timestamp' })
  created: Date;

  @Column({ type: 'varchar' })
  context: string;

  @Column({ type: 'float', nullable: true })
  preparationFeeAmountChf?: number;

  @Column({ type: 'float', nullable: true })
  payoutFeeAmountChf?: number;
}

// runs getPayoutOrderFee against a Postgres-semantics engine (pg-mem), because a mocked repository
// never executes SQL: a wrong COALESCE, a missing GROUP BY or a flipped date comparison would go
// unnoticed, and this aggregate feeds the FinanceLog
describe('PayoutService.getPayoutOrderFee (postgres semantics)', () => {
  let dataSource: DataSource;
  let repo: Repository<PayoutOrderTable>;
  let service: PayoutService;

  const from = new Date('2026-07-01T00:00:00Z');

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [PayoutOrderTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
    repo = dataSource.getRepository(PayoutOrderTable);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await repo.clear();

    // the constructor takes six collaborators this query needs none of; building the instance off the
    // prototype keeps the test from breaking every time an unrelated dependency is added
    service = Object.create(PayoutService.prototype) as PayoutService;
    (service as any).payoutOrderRepo = repo;
  });

  function feeOf(result: { context: PayoutOrderContext; fee: number }[], context: PayoutOrderContext): number {
    return result.find((r) => r.context === context)?.fee ?? 0;
  }

  it('groups the fees by context and adds up both fee columns', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-07-05'),
        context: PayoutOrderContext.REF_PAYOUT,
        preparationFeeAmountChf: 1,
        payoutFeeAmountChf: 2,
      },
      {
        id: 2,
        created: new Date('2026-07-06'),
        context: PayoutOrderContext.REF_PAYOUT,
        preparationFeeAmountChf: 0.5,
        payoutFeeAmountChf: 0.5,
      },
      {
        id: 3,
        created: new Date('2026-07-07'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: 10,
        payoutFeeAmountChf: 5,
      },
    ]);

    const result = await service.getPayoutOrderFee(from);

    expect(feeOf(result, PayoutOrderContext.REF_PAYOUT)).toBe(4);
    expect(feeOf(result, PayoutOrderContext.BUY_CRYPTO)).toBe(15);
    expect(result).toHaveLength(2);
  });

  // the previous JS getter relied on `null + x === x`; COALESCE must reproduce that exactly, not
  // turn the row into NULL (which would swallow the other, present fee) — 2 such rows exist in prod
  it('counts a row with only one fee column set, instead of dropping it', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-07-05'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: 7,
        payoutFeeAmountChf: null,
      },
      {
        id: 2,
        created: new Date('2026-07-06'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: null,
        payoutFeeAmountChf: 3,
      },
      {
        id: 3,
        created: new Date('2026-07-07'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: null,
        payoutFeeAmountChf: null,
      },
    ]);

    const result = await service.getPayoutOrderFee(from);

    expect(feeOf(result, PayoutOrderContext.BUY_CRYPTO)).toBe(10);
  });

  it('excludes orders created before the given date', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-06-30'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: 99,
        payoutFeeAmountChf: 99,
      },
      {
        id: 2,
        created: new Date('2026-07-02'),
        context: PayoutOrderContext.BUY_CRYPTO,
        preparationFeeAmountChf: 1,
        payoutFeeAmountChf: 1,
      },
    ]);

    const result = await service.getPayoutOrderFee(from);

    expect(feeOf(result, PayoutOrderContext.BUY_CRYPTO)).toBe(2);
  });

  it('returns an empty list when nothing was paid out in the period', async () => {
    const result = await service.getPayoutOrderFee(from);

    expect(result).toEqual([]);
  });
});
