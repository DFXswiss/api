import { DataType, newDb } from 'pg-mem';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn, Repository } from 'typeorm';
import { BuyFiatService } from '../buy-fiat.service';

// Mirrors only what getBuyFiatFee touches, under the real table names — see the equivalent comment in
// buy-crypto.service.pg.spec.ts on why the relations are ManyToOne here.
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

@Entity({ name: 'buy_fiat' })
class BuyFiatTable {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf?: number;

  @Column({ type: 'int' })
  transactionId: number;

  // nullable here although the real column is NOT NULL: the query LEFT-joins it on purpose, and the
  // orphan case below pins that a row can never silently drop out of the total
  @Column({ type: 'int', nullable: true })
  cryptoInputId?: number;

  @ManyToOne(() => TransactionTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'transactionId' })
  transaction: TransactionTable;

  @ManyToOne(() => CryptoInputTable, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'cryptoInputId' })
  cryptoInput?: CryptoInputTable;
}

// runs getBuyFiatFee against a Postgres-semantics engine (pg-mem); a mocked repository would execute
// neither the joins nor the CASE the regular/payment-link split is built on
describe('BuyFiatService.getBuyFiatFee (postgres semantics)', () => {
  let dataSource: DataSource;
  let buyFiatRepo: Repository<BuyFiatTable>;
  let transactionRepo: Repository<TransactionTable>;
  let cryptoInputRepo: Repository<CryptoInputTable>;
  let paymentLinkPaymentRepo: Repository<PaymentLinkPaymentTable>;
  let service: BuyFiatService;

  const from = new Date('2026-07-01T00:00:00Z');

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [BuyFiatTable, TransactionTable, CryptoInputTable, PaymentLinkPaymentTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();

    buyFiatRepo = dataSource.getRepository(BuyFiatTable);
    transactionRepo = dataSource.getRepository(TransactionTable);
    cryptoInputRepo = dataSource.getRepository(CryptoInputTable);
    paymentLinkPaymentRepo = dataSource.getRepository(PaymentLinkPaymentTable);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await buyFiatRepo.clear();
    await cryptoInputRepo.clear();
    await paymentLinkPaymentRepo.clear();
    await transactionRepo.clear();

    // the constructor takes ~20 collaborators this query needs none of; see buy-crypto.service.pg.spec.ts
    service = Object.create(BuyFiatService.prototype) as BuyFiatService;
    (service as any).buyFiatRepo = buyFiatRepo;
  });

  it('splits the fees into regular and payment-link', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-07-02') },
      { id: 2, created: new Date('2026-07-03') },
    ]);
    await paymentLinkPaymentRepo.save([{ id: 500 }]);
    await cryptoInputRepo.save([
      { id: 10, paymentLinkPaymentId: 500 },
      { id: 11, paymentLinkPaymentId: null },
    ]);
    await buyFiatRepo.save([
      { id: 1, transactionId: 1, cryptoInputId: 11, totalFeeAmountChf: 20 },
      { id: 2, transactionId: 2, cryptoInputId: 10, totalFeeAmountChf: 7 },
    ]);

    const result = await service.getBuyFiatFee(from);

    expect(result).toEqual({ regular: 20, paymentLink: 7 });
  });

  // cryptoInput is NOT NULL in the schema, so this should never happen — but the LEFT join means such
  // a row still reaches the total instead of vanishing from the finance log
  it('counts a row whose crypto input is missing as regular', async () => {
    await transactionRepo.save([{ id: 1, created: new Date('2026-07-02') }]);
    await buyFiatRepo.save([{ id: 1, transactionId: 1, cryptoInputId: null, totalFeeAmountChf: 5 }]);

    const result = await service.getBuyFiatFee(from);

    expect(result).toEqual({ regular: 5, paymentLink: 0 });
  });

  it('ignores an unset fee instead of turning the sum into NULL', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-07-02') },
      { id: 2, created: new Date('2026-07-03') },
    ]);
    await cryptoInputRepo.save([{ id: 10, paymentLinkPaymentId: null }]);
    await buyFiatRepo.save([
      { id: 1, transactionId: 1, cryptoInputId: 10, totalFeeAmountChf: null },
      { id: 2, transactionId: 2, cryptoInputId: 10, totalFeeAmountChf: 8 },
    ]);

    const result = await service.getBuyFiatFee(from);

    expect(result).toEqual({ regular: 8, paymentLink: 0 });
  });

  it('filters on the transaction date, not the buy-fiat row', async () => {
    await transactionRepo.save([
      { id: 1, created: new Date('2026-06-30') },
      { id: 2, created: new Date('2026-07-02') },
    ]);
    await cryptoInputRepo.save([{ id: 10, paymentLinkPaymentId: null }]);
    await buyFiatRepo.save([
      { id: 1, transactionId: 1, cryptoInputId: 10, totalFeeAmountChf: 99 },
      { id: 2, transactionId: 2, cryptoInputId: 10, totalFeeAmountChf: 1 },
    ]);

    const result = await service.getBuyFiatFee(from);

    expect(result).toEqual({ regular: 1, paymentLink: 0 });
  });

  it('returns zeros when there are no transactions in the period', async () => {
    const result = await service.getBuyFiatFee(from);

    expect(result).toEqual({ regular: 0, paymentLink: 0 });
  });
});
