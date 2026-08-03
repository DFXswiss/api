import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn, Repository } from 'typeorm';
import { BuyCryptoService } from '../buy-crypto.service';

// The real entities cannot be registered standalone (relations pull in the whole entity graph), so
// these tables mirror only what getBuyCryptoFee touches, under the real table names. The relations are
// ManyToOne rather than the real OneToOne: both produce the same `LEFT JOIN x ON x.id = base.fkId`,
// and ManyToOne keeps the fixtures free of uniqueness constraints the query does not depend on.
@Entity({ name: 'payment_link_payment' })
class PaymentLinkPaymentTable {
  @PrimaryColumn()
  id: number;
}

@Entity({ name: 'crypto_input' })
class CryptoInputTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  paymentLinkPaymentId?: number;

  @ManyToOne(() => PaymentLinkPaymentTable, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'paymentLinkPaymentId' })
  paymentLinkPayment?: PaymentLinkPaymentTable;
}

@Entity({ name: 'transaction' })
class TransactionTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'timestamp' })
  created: Date;
}

@Entity({ name: 'buy_crypto' })
class BuyCryptoTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf?: number;

  @Column({ type: 'int' })
  transactionId: number;

  @Column({ type: 'int', nullable: true })
  cryptoInputId?: number;

  @ManyToOne(() => TransactionTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'transactionId' })
  transaction: TransactionTable;

  @ManyToOne(() => CryptoInputTable, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'cryptoInputId' })
  cryptoInput?: CryptoInputTable;
}

// runs getBuyCryptoFee against a Postgres-semantics engine (pg-mem). The split between regular and
// payment-link fees used to be a JS filter over loaded entities; as SQL it depends on two LEFT joins
// and a CASE, none of which a mocked repository would execute
describe('BuyCryptoService.getBuyCryptoFee (postgres semantics)', () => {
  let dataSource: DataSource;
  let buyCryptoRepo: Repository<BuyCryptoTable>;
  let transactionRepo: Repository<TransactionTable>;
  let cryptoInputRepo: Repository<CryptoInputTable>;
  let paymentLinkPaymentRepo: Repository<PaymentLinkPaymentTable>;
  let service: BuyCryptoService;

  const from = new Date('2026-07-01T00:00:00Z');

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [BuyCryptoTable, TransactionTable, CryptoInputTable, PaymentLinkPaymentTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();

    buyCryptoRepo = dataSource.getRepository(BuyCryptoTable);
    transactionRepo = dataSource.getRepository(TransactionTable);
    cryptoInputRepo = dataSource.getRepository(CryptoInputTable);
    paymentLinkPaymentRepo = dataSource.getRepository(PaymentLinkPaymentTable);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await buyCryptoRepo.clear();
    await cryptoInputRepo.clear();
    await paymentLinkPaymentRepo.clear();
    await transactionRepo.clear();

    // the constructor takes ~20 collaborators this query needs none of; building the instance off the
    // prototype keeps the test from breaking every time an unrelated dependency is added
    service = Object.create(BuyCryptoService.prototype) as BuyCryptoService;
    (service as any).buyCryptoRepo = buyCryptoRepo;
  });

  it('splits the fees into regular and payment-link, keeping rows without a crypto input as regular', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-07-02') },
      { id: 2, created: new Date('2026-07-03') },
      { id: 3, created: new Date('2026-07-04') },
    ]);
    await paymentLinkPaymentRepo.save([{ id: 500 }]);
    await cryptoInputRepo.save([
      { id: 10, paymentLinkPaymentId: 500 },
      { id: 11, paymentLinkPaymentId: null },
    ]);
    await buyCryptoRepo.save([
      // bank purchase: no crypto input at all -> regular (this is the majority of rows in prod)
      { id: 1, transactionId: 1, cryptoInputId: null, totalFeeAmountChf: 100 },
      // crypto input without a payment link -> regular
      { id: 2, transactionId: 2, cryptoInputId: 11, totalFeeAmountChf: 20 },
      // crypto input with a payment link -> paymentLink
      { id: 3, transactionId: 3, cryptoInputId: 10, totalFeeAmountChf: 3 },
    ]);

    const result = await service.getBuyCryptoFee(from);

    expect(result).toEqual({ regular: 120, paymentLink: 3 });
  });

  it('ignores an unset fee instead of turning the sum into NULL', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-07-02') },
      { id: 2, created: new Date('2026-07-03') },
    ]);
    await buyCryptoRepo.save([
      { id: 1, transactionId: 1, cryptoInputId: null, totalFeeAmountChf: null },
      { id: 2, transactionId: 2, cryptoInputId: null, totalFeeAmountChf: 8 },
    ]);

    const result = await service.getBuyCryptoFee(from);

    expect(result).toEqual({ regular: 8, paymentLink: 0 });
  });

  it('filters on the transaction date, not the buy-crypto row', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-06-30') },
      { id: 2, created: new Date('2026-07-02') },
    ]);
    await buyCryptoRepo.save([
      { id: 1, transactionId: 1, cryptoInputId: null, totalFeeAmountChf: 99 },
      { id: 2, transactionId: 2, cryptoInputId: null, totalFeeAmountChf: 1 },
    ]);

    const result = await service.getBuyCryptoFee(from);

    expect(result).toEqual({ regular: 1, paymentLink: 0 });
  });

  it('returns zeros when there are no transactions in the period', async () => {
    const result = await service.getBuyCryptoFee(from);

    expect(result).toEqual({ regular: 0, paymentLink: 0 });
  });
});
