import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn, Repository } from 'typeorm';
import { ConfigService } from 'src/config/config';
import { PartnerStatisticGranularity } from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

/**
 * Real-Postgres integration for partner-statistic **service methods**.
 * Skipped unless MIGRATION_TEST_PG is set (CI / local disposable DB).
 *
 * Calls `getStatistics` / `getTimeline` / `mergeNamedRows` against a minimal schema that
 * mirrors the production join columns. Lightweight entity stubs provide TypeORM relation
 * metadata so `createQueryBuilder('tx').innerJoin('tx.buy', …)` resolves correctly.
 *
 * SWAP path: `crypto_route` table is present but empty — swap aggregates return zero.
 * SELL asset blockchain needs `crypto_input`; left-joined, so missing rows yield null blockchain.
 */

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'partner_statistic_spec';

// --- Minimal entities (relation graph only; no production entity import tree) --- //

@Entity({ name: 'user' })
class TestUser {
  @PrimaryColumn() id: number;
  @Column() walletId: number;
  @Column({ type: 'numeric', default: 0 }) buyVolume: number;
  @Column({ type: 'numeric', default: 0 }) sellVolume: number;
  @Column({ type: 'timestamp' }) created: Date;
  @Column({ type: 'numeric', default: 0 }) partnerRefVolume: number;
  @Column({ type: 'numeric', default: 0 }) partnerRefCredit: number;
  @Column({ type: 'numeric', default: 0 }) refCredit: number;
  @Column({ type: 'numeric', default: 0 }) paidRefCredit: number;
}

@Entity({ name: 'wallet' })
class TestWallet {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestUser, { nullable: true })
  @JoinColumn({ name: 'ownerId' })
  owner?: TestUser;
}

@Entity({ name: 'buy' })
class TestBuy {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestUser)
  @JoinColumn({ name: 'userId' })
  user: TestUser;
}

@Entity({ name: 'sell' })
class TestSell {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestUser)
  @JoinColumn({ name: 'userId' })
  user: TestUser;
}

@Entity({ name: 'crypto_route' })
class TestCryptoRoute {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestUser)
  @JoinColumn({ name: 'userId' })
  user: TestUser;
}

@Entity({ name: 'asset' })
class TestAsset {
  @PrimaryColumn() id: number;
  @Column({ type: 'varchar', length: 256, nullable: true }) name?: string;
  @Column({ type: 'varchar', length: 256, nullable: true }) blockchain?: string;
}

@Entity({ name: 'transaction' })
class TestTransaction {
  @PrimaryColumn() id: number;
  @Column({ type: 'varchar', length: 256, nullable: true }) sourceType?: string;
}

@Entity({ name: 'crypto_input' })
class TestCryptoInput {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestAsset, { nullable: true })
  @JoinColumn({ name: 'assetId' })
  asset?: TestAsset;
}

@Entity({ name: 'buy_crypto' })
class TestBuyCrypto {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestBuy, { nullable: true })
  @JoinColumn({ name: 'buyId' })
  buy?: TestBuy;
  @ManyToOne(() => TestCryptoRoute, { nullable: true })
  @JoinColumn({ name: 'cryptoRouteId' })
  cryptoRoute?: TestCryptoRoute;
  @ManyToOne(() => TestAsset, { nullable: true })
  @JoinColumn({ name: 'outputAssetId' })
  outputAsset?: TestAsset;
  @ManyToOne(() => TestTransaction, { nullable: true })
  @JoinColumn({ name: 'transactionId' })
  transaction?: TestTransaction;
  @Column({ type: 'numeric', default: 0 }) amountInChf: number;
  @Column({ type: 'varchar', length: 256, nullable: true }) inputAsset?: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) amlCheck?: string;
  @Column({ type: 'timestamp' }) created: Date;
}

@Entity({ name: 'buy_fiat' })
class TestBuyFiat {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TestSell, { nullable: true })
  @JoinColumn({ name: 'sellId' })
  sell?: TestSell;
  @ManyToOne(() => TestCryptoInput, { nullable: true })
  @JoinColumn({ name: 'cryptoInputId' })
  cryptoInput?: TestCryptoInput;
  @ManyToOne(() => TestAsset, { nullable: true })
  @JoinColumn({ name: 'outputAssetId' })
  outputAsset?: TestAsset;
  @ManyToOne(() => TestTransaction, { nullable: true })
  @JoinColumn({ name: 'transactionId' })
  transaction?: TestTransaction;
  @Column({ type: 'numeric', default: 0 }) amountInChf: number;
  @Column({ type: 'varchar', length: 256, nullable: true }) inputAsset?: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) amlCheck?: string;
  @Column({ type: 'timestamp' }) created: Date;
}

const ENTITIES = [
  TestUser,
  TestWallet,
  TestBuy,
  TestSell,
  TestCryptoRoute,
  TestAsset,
  TestTransaction,
  TestCryptoInput,
  TestBuyCrypto,
  TestBuyFiat,
];

describeDb('PartnerStatisticService SQL path (real Postgres)', () => {
  let dataSource: DataSource;
  let service: PartnerStatisticService;
  let prevTz: string | undefined;

  beforeAll(async () => {
    // Confine TZ change to this suite only (D3) — never set process.env.TZ at module scope.
    prevTz = process.env.TZ;
    process.env.TZ = 'UTC';

    new ConfigService();
    dataSource = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${SCHEMA}"`);
    await dataSource.query(`SET search_path TO "${SCHEMA}"`);

    await dataSource.query(`
      CREATE TABLE "user" (
        "id" int PRIMARY KEY,
        "walletId" int NOT NULL,
        "buyVolume" numeric DEFAULT 0,
        "sellVolume" numeric DEFAULT 0,
        "created" TIMESTAMP NOT NULL DEFAULT NOW(),
        "partnerRefVolume" numeric DEFAULT 0,
        "partnerRefCredit" numeric DEFAULT 0,
        "refCredit" numeric DEFAULT 0,
        "paidRefCredit" numeric DEFAULT 0
      );
      CREATE TABLE "wallet" (
        "id" int PRIMARY KEY,
        "ownerId" int
      );
      CREATE TABLE "buy" (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE "sell" (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE "crypto_route" (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE "asset" (
        "id" int PRIMARY KEY,
        "name" varchar(256),
        "blockchain" varchar(256)
      );
      CREATE TABLE "transaction" (
        "id" int PRIMARY KEY,
        "sourceType" varchar(256)
      );
      CREATE TABLE "crypto_input" (
        "id" int PRIMARY KEY,
        "assetId" int
      );
      CREATE TABLE "buy_crypto" (
        "id" SERIAL PRIMARY KEY,
        "buyId" int,
        "cryptoRouteId" int,
        "outputAssetId" int,
        "transactionId" int,
        "amountInChf" numeric DEFAULT 0,
        "inputAsset" varchar(256),
        "amlCheck" varchar(64),
        "created" TIMESTAMP NOT NULL
      );
      CREATE TABLE "buy_fiat" (
        "id" SERIAL PRIMARY KEY,
        "sellId" int,
        "cryptoInputId" int,
        "outputAssetId" int,
        "transactionId" int,
        "amountInChf" numeric DEFAULT 0,
        "inputAsset" varchar(256),
        "amlCheck" varchar(64),
        "created" TIMESTAMP NOT NULL
      );
    `);

    await dataSource.query(`
      INSERT INTO "user" ("id", "walletId", "buyVolume", "sellVolume", "created",
        "partnerRefVolume", "partnerRefCredit", "refCredit", "paidRefCredit") VALUES
        (1, 1, 100, 0, '2024-06-01 10:00:00', 0, 0, 0, 0),
        (2, 1, 100, 0, '2024-06-01 11:00:00', 0, 0, 0, 0),
        (3, 1, 100, 0, '2024-06-01 12:00:00', 0, 0, 0, 0),
        (4, 1, 100, 0, '2024-06-01 13:00:00', 0, 0, 0, 0),
        (5, 1, 100, 50, '2024-06-01 14:00:00', 0, 0, 0, 0),
        (6, 2, 999, 0, '2024-06-01 10:00:00', 0, 0, 0, 0),
        (100, 1, 0, 0, '2024-01-01 00:00:00', 42.5, 12.25, 5, 2.25);
      INSERT INTO "wallet" ("id", "ownerId") VALUES (1, 100), (2, 6);
      INSERT INTO "buy" ("id", "userId") VALUES (1,1),(2,2),(3,3),(4,4),(5,5),(6,6);
      INSERT INTO "sell" ("id", "userId") VALUES (1,5);
      INSERT INTO "asset" ("id", "name", "blockchain") VALUES
        (1, 'BTC', 'Bitcoin'), (2, 'ETH', 'Ethereum'), (3, 'CHF', NULL);
      INSERT INTO "transaction" ("id", "sourceType") VALUES
        (1, 'BankTx'), (2, 'BankTx'), (3, 'BankTx'), (4, 'BankTx'), (5, 'BankTx'), (6, 'BankTx'), (7, 'BankTx');
      INSERT INTO "crypto_input" ("id", "assetId") VALUES (1, 1);
      INSERT INTO "buy_crypto"
        ("buyId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        (1, 1, 1, 100, 'Pass', '2024-06-10 10:00:00', 'CHF'),
        (2, 1, 2, 100, 'Pass', '2024-06-10 11:00:00', 'CHF'),
        (3, 1, 3, 100, 'Pass', '2024-06-10 12:00:00', 'CHF'),
        (4, 1, 4, 100, 'Pass', '2024-06-11 10:00:00', 'CHF'),
        (5, 1, 5, 100, 'Pass', '2024-06-11 11:00:00', 'CHF'),
        (6, 2, 6, 9999, 'Pass', '2024-06-10 10:00:00', 'CHF');
      INSERT INTO "buy_fiat"
        ("sellId", "cryptoInputId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        (1, 1, 3, 7, 50, 'Pass', '2024-06-11 12:00:00', 'BTC');
    `);

    const buyCryptoRepo = dataSource.getRepository(TestBuyCrypto) as unknown as Repository<TestBuyCrypto>;
    const buyFiatRepo = dataSource.getRepository(TestBuyFiat) as unknown as Repository<TestBuyFiat>;
    const userRepo = dataSource.getRepository(TestUser) as unknown as Repository<TestUser>;
    const walletRepo = dataSource.getRepository(TestWallet) as unknown as Repository<TestWallet>;

    service = new PartnerStatisticService(buyCryptoRepo as any, buyFiatRepo as any, userRepo as any, walletRepo as any);
  });

  afterEach(async () => {
    await dataSource.query(`SET search_path TO public`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  });

  afterAll(async () => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('getStatistics aggregates real rows: volume, active users, breakdown, referral; scopes wallet', async () => {
    const from = new Date('2024-06-01T00:00:00.000Z');
    const to = new Date('2024-06-30T00:00:00.000Z');

    const result = await service.getStatistics(1, from, to);

    // buy 5×100 = 500; sell 50; swap 0 (no crypto_route rows — documented)
    // sell has 1 tx → period totals block-suppressed (under k on sell direction)
    expect(result.totals.volume.total).toBeNull();
    expect(result.totals.volume.buy).toBeNull();
    expect(result.totals.volume.sell).toBeNull();

    // Foreign wallet (id=2) volume must not inflate anything when totals become visible at k
    // — exercised via active-user / allTime scope instead:
    expect(result.allTime.registeredUsers).toBe(6); // users 1–5 + owner 100 on wallet 1
    expect(result.allTime.registeredUsers).not.toBe(7); // must not include wallet-2 user 6

    // Referral from wallet.owner (user 100)
    expect(result.referral.volume).toBe(42.5);
    expect(result.referral.creditEarned).toBe(12.25);
    expect(result.referral.creditOpen).toBe(15);
    expect(result.referral.currency).toBe('EUR');

    // Asset breakdown: BTC buy rows (5 txs ≥ k after complementary may still drop)
    // RARE path not present; COMMON BTC has 5 txs at exactly k — visible unless complementary.
    const btc = result.breakdown.assets.filter((a) => a.name === 'BTC');
    expect(btc.length).toBeGreaterThanOrEqual(1);
    expect(btc.some((a) => a.volume === 500)).toBe(true);

    // No internal users field on the public payload
    expect(JSON.stringify(result)).not.toMatch(/"users"/);
  });

  it('getTimeline builds UTC day buckets from real DATE_TRUNC rows and applies suppression', async () => {
    const result = await service.getTimeline(
      1,
      '2024-06-10T00:00:00.000Z',
      '2024-06-11T23:59:59.000Z',
      PartnerStatisticGranularity.DAY,
    );

    expect(result.buckets.length).toBe(2);
    expect(result.buckets.map((b) => b.date.toISOString())).toEqual([
      '2024-06-10T00:00:00.000Z',
      '2024-06-11T00:00:00.000Z',
    ]);

    // Day-1 has 3 buy txs (under k) → suppressed; day-2 has 2 buy + 1 sell = 3 under k → suppressed
    expect(result.buckets[0].suppressed).toBe(true);
    expect(result.buckets[0].volume).toBeNull();
    expect(result.buckets[1].suppressed).toBe(true);
    expect(result.buckets[1].volume).toBeNull();

    expect(JSON.stringify(result)).not.toMatch(/"users"/);
  });

  it('half-open period excludes the exclusive end instant (semantic, not only SQL string)', async () => {
    // Insert a buy_crypto exactly at the exclusive end (2024-06-12 00:00) — must not count.
    await dataSource.query(`
      INSERT INTO "buy_crypto"
        ("buyId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES (1, 1, 1, 777, 'Pass', '2024-06-12 00:00:00', 'CHF');
    `);

    // Period [2024-06-10, 2024-06-12) — the 777 row is at `to` exclusive boundary.
    // Use private aggregate via getTimeline bucket counts: only days 10 and 11.
    const result = await service.getTimeline(
      1,
      '2024-06-10T00:00:00.000Z',
      '2024-06-11T23:59:59.000Z',
      PartnerStatisticGranularity.DAY,
    );
    expect(result.buckets).toHaveLength(2);
    // No third bucket for June 12
    expect(result.buckets.every((b) => b.date.toISOString() < '2024-06-12T00:00:00.000Z')).toBe(true);

    // Direct direction aggregate through service private method for the same half-open window
    const agg = await service['aggregateByDirection'](
      1,
      new Date('2024-06-10T00:00:00.000Z'),
      new Date('2024-06-12T00:00:00.000Z'),
      // PartnerStatisticDirection.BUY
      'Buy' as any,
    );
    // 5 buy rows in window (not the 777 at 06-12)
    expect(agg.transactions).toBe(5);
    expect(agg.volume).toBe(500);
    expect(agg.volume).not.toBe(500 + 777);
  });

  it('mergeNamedRows still works on real GROUP BY output', async () => {
    const rows = await dataSource
      .createQueryBuilder()
      .select('a.name', 'name')
      .addSelect('a.blockchain', 'blockchain')
      .addSelect('COALESCE(SUM(tx."amountInChf"), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .from('buy_crypto', 'tx')
      .innerJoin('buy', 'route', 'route.id = tx."buyId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .leftJoin('asset', 'a', 'a.id = tx."outputAssetId"')
      .where('u."walletId" = :walletId', { walletId: 1 })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' })
      .groupBy('a.name')
      .addGroupBy('a.blockchain')
      .getRawMany<{ name: string; blockchain: string; volume: string; transactions: string; users: string }>();

    const merged = service.mergeNamedRows(
      rows.map((r) => ({
        name: r.name,
        blockchain: r.blockchain,
        volume: r.volume,
        transactions: r.transactions,
        users: r.users,
      })),
    );
    expect(merged.find((r) => r.name === 'BTC')?.volume).toBe(500);
    expect(typeof merged[0].volume).toBe('number');
  });
});
