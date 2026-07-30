import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';
import { ExchangeName } from '../../enums/exchange.enum';
import { ExchangeTxType } from '../../entities/exchange-tx.entity';
import { ExchangeTxService } from '../exchange-tx.service';

// mirrors only the columns getExchangeTxFee touches, under the real table name — the full entity
// cannot be registered standalone
@Entity({ name: 'exchange_tx' })
class ExchangeTxTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'timestamp' })
  created: Date;

  @Column({ type: 'varchar' })
  exchange: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'float', nullable: true })
  feeAmountChf?: number;
}

// runs getExchangeTxFee against a Postgres-semantics engine (pg-mem): the netting of rebates and the
// grouping used to happen in JS and was covered there; now it is SQL, and a mocked repository would
// execute none of it
describe('ExchangeTxService.getExchangeTxFee (postgres semantics)', () => {
  let dataSource: DataSource;
  let repo: Repository<ExchangeTxTable>;
  let service: ExchangeTxService;

  const from = new Date('2026-07-01T00:00:00Z');

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [ExchangeTxTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
    repo = dataSource.getRepository(ExchangeTxTable);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await repo.clear();

    // this query needs none of the constructor's collaborators; building off the prototype keeps the
    // test from breaking when an unrelated dependency is added
    service = Object.create(ExchangeTxService.prototype) as ExchangeTxService;
    (service as any).exchangeTxRepo = repo;
  });

  function feeOf(
    result: { exchange: ExchangeName; type: ExchangeTxType; fee: number }[],
    exchange: ExchangeName,
    type: ExchangeTxType,
  ): number {
    return result.find((r) => r.exchange === exchange && r.type === type)?.fee ?? 0;
  }

  it('nets fees per exchange and type, including negative rebates', async () => {
    await repo.save([
      // Scrypt trading: 240 minus a 20 rebate -> 220 net
      {
        id: 1,
        created: new Date('2026-07-02'),
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        feeAmountChf: 240,
      },
      {
        id: 2,
        created: new Date('2026-07-03'),
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        feeAmountChf: -20,
      },
      {
        id: 3,
        created: new Date('2026-07-04'),
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.WITHDRAWAL,
        feeAmountChf: 10,
      },
      {
        id: 4,
        created: new Date('2026-07-05'),
        exchange: ExchangeName.MEXC,
        type: ExchangeTxType.TRADE,
        feeAmountChf: 18,
      },
    ]);

    const result = await service.getExchangeTxFee(from);

    expect(feeOf(result, ExchangeName.SCRYPT, ExchangeTxType.TRADE)).toBe(220);
    expect(feeOf(result, ExchangeName.SCRYPT, ExchangeTxType.WITHDRAWAL)).toBe(10);
    expect(feeOf(result, ExchangeName.MEXC, ExchangeTxType.TRADE)).toBe(18);
    // one row per occurring combination, not per transaction
    expect(result).toHaveLength(3);
  });

  it('reports 0 instead of NULL for a group whose fees are all unset', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-07-02'),
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.DEPOSIT,
        feeAmountChf: null,
      },
      {
        id: 2,
        created: new Date('2026-07-03'),
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.DEPOSIT,
        feeAmountChf: null,
      },
    ]);

    const result = await service.getExchangeTxFee(from);

    expect(result).toEqual([{ exchange: ExchangeName.BINANCE, type: ExchangeTxType.DEPOSIT, fee: 0 }]);
  });

  it('ignores an unset fee but keeps the rest of its group', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-07-02'),
        exchange: ExchangeName.KRAKEN,
        type: ExchangeTxType.TRADE,
        feeAmountChf: null,
      },
      {
        id: 2,
        created: new Date('2026-07-03'),
        exchange: ExchangeName.KRAKEN,
        type: ExchangeTxType.TRADE,
        feeAmountChf: 12,
      },
    ]);

    const result = await service.getExchangeTxFee(from);

    expect(feeOf(result, ExchangeName.KRAKEN, ExchangeTxType.TRADE)).toBe(12);
  });

  it('excludes transactions created before the given date', async () => {
    await repo.save([
      {
        id: 1,
        created: new Date('2026-06-30'),
        exchange: ExchangeName.KRAKEN,
        type: ExchangeTxType.TRADE,
        feeAmountChf: 99,
      },
      {
        id: 2,
        created: new Date('2026-07-02'),
        exchange: ExchangeName.KRAKEN,
        type: ExchangeTxType.TRADE,
        feeAmountChf: 1,
      },
    ]);

    const result = await service.getExchangeTxFee(from);

    expect(feeOf(result, ExchangeName.KRAKEN, ExchangeTxType.TRADE)).toBe(1);
  });

  it('returns an empty list when there are no transactions in the period', async () => {
    const result = await service.getExchangeTxFee(from);

    expect(result).toEqual([]);
  });
});
