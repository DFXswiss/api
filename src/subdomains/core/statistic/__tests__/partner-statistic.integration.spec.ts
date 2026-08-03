import { execFileSync } from 'child_process';
import * as path from 'path';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn, Repository } from 'typeorm';
import { ConfigService } from 'src/config/config';
import { isProcessTimezoneUtcYearRound } from 'src/process-timezone';
import { PartnerStatisticGranularity } from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

/**
 * Real-Postgres integration for partner-statistic **service methods**.
 *
 * Runs only when BOTH are true:
 *   1. MIGRATION_TEST_PG is set (CI / local disposable DB)
 *   2. Process timezone is UTC year-round (Jan + Jul anchors via `isProcessTimezoneUtcYearRound`)
 *
 * CI meets the UTC process-timezone condition. This suite deliberately does **not**
 * force `process.env.TZ = 'UTC'` (that would hide the dependency and leak into other
 * specs in the same Jest worker). The application expects `ENV TZ=UTC` (Dockerfile)
 * and logs/warns via `checkProcessTimezone` at process start. Run this suite with
 * `TZ=UTC` when developing outside UTC.
 *
 * Why UTC process TZ is required: `created` is `timestamp without time zone`. The
 * Postgres driver serializes a JS `Date` in process-local wall time; Postgres then
 * drops the offset. Session `TimeZone=UTC` does not fix driver-side serialization.
 * A single `new Date().getTimezoneOffset() === 0` would wrongly accept Europe/London
 * in winter — same trap as the process-timezone boot check.
 *
 * Calls `getStatistics` / `getTimeline` / `mergeNamedRows` against a minimal schema that
 * mirrors the production join columns. Lightweight entity stubs provide TypeORM relation
 * metadata so `createQueryBuilder('tx').innerJoin('tx.buy', …)` resolves correctly.
 *
 * SWAP path: `crypto_route` table is present but empty — swap aggregates return zero.
 * SELL asset blockchain needs `crypto_input`; left-joined, so missing rows yield null blockchain.
 */

const PG_URL = process.env.MIGRATION_TEST_PG;
// Year-round offset (Jan + Jul), not "today": IANA name alone can be empty/non-UTC under
// odd hosts even when the wall clock is already UTC-offset; a single getTimezoneOffset()
// would accept London in winter.
const isProcessTimezoneUtc = isProcessTimezoneUtcYearRound();
const describeDb = PG_URL && isProcessTimezoneUtc ? describe : describe.skip;

if (PG_URL && !isProcessTimezoneUtc) {
  const resolved = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '(unknown)';
  const jan = new Date(Date.UTC(2024, 0, 15, 12, 0, 0)).getTimezoneOffset();
  const jul = new Date(Date.UTC(2024, 6, 15, 12, 0, 0)).getTimezoneOffset();
  console.warn(
    `[partner-statistic.integration] suite skipped: process timezone must be UTC year-round ` +
      `(got january=${jan} min, july=${jul} min, timeZone=${resolved}). ` +
      `Column "created" is timestamp without time zone; the Postgres driver serializes ` +
      `JS Date values in process-local wall time and Postgres drops the offset, so ` +
      `half-open period bounds shift under non-UTC hosts. The application expects ` +
      `ENV TZ=UTC and checkProcessTimezone at start. Run with TZ=UTC when developing ` +
      `outside UTC.`,
  );
}

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

  /** Schema-qualified table name — never rely on session search_path. */
  const t = (name: string) => `"${SCHEMA}"."${name}"`;

  beforeAll(async () => {
    new ConfigService();
    // `schema` qualifies every entity table name so QueryBuilder work is correct on any
    // pool connection. DDL/DML below also uses fully qualified names — never SET search_path
    // (session-bound; a pooled client that skipped the SET would create public."user" and
    // race other suites). max:1 keeps setup + fan-out on one backend when the driver allows.
    // Session TimeZone=UTC is still set so PG-side TIMESTAMP arithmetic stays UTC; it does
    // not fix driver-side JS Date serialization (see file header — process TZ must be UTC).
    dataSource = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: ENTITIES,
      synchronize: false,
      schema: SCHEMA,
      extra: { max: 1, options: '-c TimeZone=UTC' },
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${SCHEMA}"`);

    await dataSource.query(`
      CREATE TABLE ${t('user')} (
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
      CREATE TABLE ${t('wallet')} (
        "id" int PRIMARY KEY,
        "ownerId" int
      );
      CREATE TABLE ${t('buy')} (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE ${t('sell')} (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE ${t('crypto_route')} (
        "id" int PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE ${t('asset')} (
        "id" int PRIMARY KEY,
        "name" varchar(256),
        "blockchain" varchar(256)
      );
      CREATE TABLE ${t('transaction')} (
        "id" int PRIMARY KEY,
        "sourceType" varchar(256)
      );
      CREATE TABLE ${t('crypto_input')} (
        "id" int PRIMARY KEY,
        "assetId" int
      );
      CREATE TABLE ${t('buy_crypto')} (
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
      CREATE TABLE ${t('buy_fiat')} (
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
      INSERT INTO ${t('user')} ("id", "walletId", "buyVolume", "sellVolume", "created",
        "partnerRefVolume", "partnerRefCredit", "refCredit", "paidRefCredit") VALUES
        (1, 1, 100, 0, '2024-06-01 10:00:00', 0, 0, 0, 0),
        (2, 1, 100, 0, '2024-06-01 11:00:00', 0, 0, 0, 0),
        (3, 1, 100, 0, '2024-06-01 12:00:00', 0, 0, 0, 0),
        (4, 1, 100, 0, '2024-06-01 13:00:00', 0, 0, 0, 0),
        (5, 1, 100, 50, '2024-06-01 14:00:00', 0, 0, 0, 0),
        (6, 2, 999, 0, '2024-06-01 10:00:00', 0, 0, 0, 0),
        (100, 1, 0, 0, '2024-01-01 00:00:00', 42.5, 12.25, 5, 2.25);
      INSERT INTO ${t('wallet')} ("id", "ownerId") VALUES (1, 100), (2, 6);
      INSERT INTO ${t('buy')} ("id", "userId") VALUES (1,1),(2,2),(3,3),(4,4),(5,5),(6,6);
      INSERT INTO ${t('sell')} ("id", "userId") VALUES (1,5);
      INSERT INTO ${t('asset')} ("id", "name", "blockchain") VALUES
        (1, 'BTC', 'Bitcoin'), (2, 'ETH', 'Ethereum'), (3, 'CHF', NULL);
      INSERT INTO ${t('transaction')} ("id", "sourceType") VALUES
        (1, 'BankTx'), (2, 'BankTx'), (3, 'BankTx'), (4, 'BankTx'), (5, 'BankTx'), (6, 'BankTx'), (7, 'BankTx');
      INSERT INTO ${t('crypto_input')} ("id", "assetId") VALUES (1, 1);
      INSERT INTO ${t('buy_crypto')}
        ("buyId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        (1, 1, 1, 100, 'Pass', '2024-06-10 10:00:00', 'CHF'),
        (2, 1, 2, 100, 'Pass', '2024-06-10 11:00:00', 'CHF'),
        (3, 1, 3, 100, 'Pass', '2024-06-10 12:00:00', 'CHF'),
        (4, 1, 4, 100, 'Pass', '2024-06-11 10:00:00', 'CHF'),
        (5, 1, 5, 100, 'Pass', '2024-06-11 11:00:00', 'CHF'),
        (6, 2, 6, 9999, 'Pass', '2024-06-10 10:00:00', 'CHF');
      INSERT INTO ${t('buy_fiat')}
        ("sellId", "cryptoInputId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        -- inputAsset left null: the SELL asset row is not the subject of this fixture,
        -- which exercises the buy-side asset join against real rows.
        (1, 1, 3, 7, 50, 'Pass', '2024-06-11 12:00:00', NULL);
    `);

    const buyCryptoRepo = dataSource.getRepository(TestBuyCrypto) as unknown as Repository<TestBuyCrypto>;
    const buyFiatRepo = dataSource.getRepository(TestBuyFiat) as unknown as Repository<TestBuyFiat>;
    const userRepo = dataSource.getRepository(TestUser) as unknown as Repository<TestUser>;
    const walletRepo = dataSource.getRepository(TestWallet) as unknown as Repository<TestWallet>;

    service = new PartnerStatisticService(buyCryptoRepo as any, buyFiatRepo as any, userRepo as any, walletRepo as any);
  });

  afterEach(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('getStatistics aggregates real rows: volume, active users, breakdown, referral; scopes wallet', async () => {
    const from = new Date('2024-06-01T00:00:00.000Z');
    const to = new Date('2024-06-30T00:00:00.000Z');

    const result = await service.getStatistics(1, from, to);

    // buy 5×100 = 500; sell 50; swap 0 (no crypto_route rows — documented)
    expect(result.totals.volume.buy).toBe(500);
    expect(result.totals.volume.sell).toBe(50);
    expect(result.totals.volume.swap).toBe(0);
    expect(result.totals.volume.total).toBe(550);

    // Foreign wallet (id=2) rows must not inflate anything:
    expect(result.allTime.registeredUsers).toBe(6); // users 1–5 + owner 100 on wallet 1
    expect(result.allTime.registeredUsers).not.toBe(7); // must not include wallet-2 user 6

    // Referral from wallet.owner (user 100)
    expect(result.referral.volume).toBe(42.5);
    expect(result.referral.creditEarned).toBe(12.25);
    expect(result.referral.creditOpen).toBe(15);
    expect(result.referral.currency).toBe('EUR');

    // Asset breakdown: BUY BTC has 5 txs at exactly k and is visible (no under-k named
    // SELL asset in this fixture — see seed comment — so complementary does not fire).
    // Seed has exactly one BTC asset row → pin count so a missing BTC row fails.
    const btc = result.breakdown.assets.filter((a) => a.name === 'BTC');
    expect(btc).toHaveLength(1);
    expect(btc[0].volume).toBe(500);

    // No internal users field on the public payload
    expect(JSON.stringify(result)).not.toMatch(/"users"/);
  });

  it('getTimeline builds UTC day buckets from real DATE_TRUNC rows', async () => {
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

    // Day-1 has 3 buy txs, day-2 has 2 buy + 1 sell — every day reports what happened.
    expect(result.buckets[0].volume?.buy).toBe(300);
    expect(result.buckets[1].volume?.buy).toBe(200);
    expect(result.buckets[1].volume?.sell).toBe(50);

    expect(JSON.stringify(result)).not.toMatch(/"users"/);
  });

  it('countActiveUsers is a set across directions (UNION, not UNION ALL)', async () => {
    // Three users each active on buy AND sell → DISTINCT 3; bag-count (UNION ALL) would be 6.
    // The DTO reports activeUsers from this set; a bag count would double anyone active in two directions.
    await dataSource.query(`DELETE FROM ${t('buy_crypto')}`);
    await dataSource.query(`DELETE FROM ${t('buy_fiat')}`);
    await dataSource.query(`DELETE FROM ${t('sell')}`);
    await dataSource.query(`DELETE FROM ${t('buy')}`);
    await dataSource.query(`
      INSERT INTO ${t('buy')} ("id", "userId") VALUES (1,1),(2,2),(3,3);
      INSERT INTO ${t('sell')} ("id", "userId") VALUES (1,1),(2,2),(3,3);
      INSERT INTO ${t('buy_crypto')}
        ("buyId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        (1, 1, 1, 100, 'Pass', '2024-06-10 10:00:00', 'CHF'),
        (2, 1, 2, 100, 'Pass', '2024-06-10 11:00:00', 'CHF'),
        (3, 1, 3, 100, 'Pass', '2024-06-10 12:00:00', 'CHF');
      INSERT INTO ${t('buy_fiat')}
        ("sellId", "cryptoInputId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "created", "inputAsset")
      VALUES
        (1, 1, 3, 4, 50, 'Pass', '2024-06-10 13:00:00', NULL),
        (2, 1, 3, 5, 50, 'Pass', '2024-06-10 14:00:00', NULL),
        (3, 1, 3, 6, 50, 'Pass', '2024-06-10 15:00:00', NULL);
    `);

    const from = new Date('2024-06-01T00:00:00.000Z');
    const to = new Date('2024-06-30T00:00:00.000Z');
    const count = await service['countActiveUsers'](1, from, to);
    expect(count).toBe(3);
    expect(count).not.toBe(6);

    // Public path reports the same set: UNION ALL would surface 6.
    const result = await service.getStatistics(1, from, to);
    expect(result.totals.activeUsers).toBe(3);
    expect(result.totals.activeUsers).not.toBe(6);
  });

  it('half-open period excludes the exclusive end instant (semantic, not only SQL string)', async () => {
    // Insert a buy_crypto exactly at the exclusive end (2024-06-12 00:00) — must not count.
    await dataSource.query(`
      INSERT INTO ${t('buy_crypto')}
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
    // Entity QB (schema from DataSource) — no search_path, no bare table names.
    const rows = await dataSource
      .getRepository(TestBuyCrypto)
      .createQueryBuilder('tx')
      .select('a.name', 'name')
      .addSelect('a.blockchain', 'blockchain')
      .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .innerJoin(TestBuy, 'route', 'route.id = tx.buyId')
      .innerJoin(TestUser, 'u', 'u.id = route.userId')
      .leftJoin(TestAsset, 'a', 'a.id = tx.outputAssetId')
      .where('u.walletId = :walletId', { walletId: 1 })
      .andWhere('tx.amlCheck = :check', { check: 'Pass' })
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

// --- M4: AT TIME ZONE 'UTC' binding must hold even when the process is NOT UTC --- //

/**
 * `describeDb` above (and its `getTimeline` test) only runs under a UTC process timezone,
 * which is exactly the condition under which a missing `AT TIME ZONE 'UTC'` binding would be
 * invisible (process offset 0 makes both SQL forms return the same instant). This block is
 * gated only on `PG_URL` — not on `isProcessTimezoneUtcYearRound()` — so it must genuinely
 * exercise a non-UTC offset regardless of the ambient host/CI timezone.
 *
 * Verified empirically: mutating `process.env.TZ` inside a `beforeAll`/`it` does NOT change
 * `Date.prototype.getTimezoneOffset()` for the rest of this Jest worker process (checked with a
 * minimal repro — even as the very first Date operation in a fresh describe block, the change
 * has no effect here). Node/V8 resolves the process-default timezone once and does not re-read
 * `process.env.TZ` afterwards in this repo's Jest setup. A `process.env.TZ` assignment can
 * therefore not be used to prove this property, and doing so would silently test nothing new
 * whenever the ambient TZ under which Jest itself was launched happens to already be non-UTC
 * (it would then "pass" while only ever exercising that ambient zone, never provably switching).
 *
 * The only reliable way to exercise a genuinely different process timezone is a fresh child
 * process started with that `TZ` in its env from the beginning — see
 * `partner-statistic-tz-check.script.ts`, executed here via `ts-node` so it runs the REAL
 * `timelineByDirection` production code, not a hand-copied SQL string.
 */
const describePgAnyTz = PG_URL ? describe : describe.skip;

describePgAnyTz('PartnerStatisticService timeline UTC binding under non-UTC process TZ (M4)', () => {
  const TZ_SCHEMA = 'partner_statistic_tz_spec';
  const tz = (name: string) => `"${TZ_SCHEMA}"."${name}"`;
  // Asia/Tokyo: fixed +09:00, no DST (deterministic). MUST be a zone AHEAD of UTC — a zone
  // behind UTC (e.g. America/New_York, -04:00 in June) was tried first and turned out to be a
  // false negative: misparsing a wall-clock midnight as a few hours *later* in the same UTC
  // calendar day still collapses back to the same day once startOfBucket() re-truncates to UTC
  // midnight, so the missing binding stayed invisible. A zone ahead of UTC misparses the same
  // midnight as being on the *previous* UTC calendar day, which does change the bucket key —
  // verified by hand against the raw driver output before relying on it here.
  const CHECK_TZ = 'Asia/Tokyo';

  let dataSource: DataSource;

  beforeAll(async () => {
    new ConfigService();
    dataSource = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: ENTITIES,
      synchronize: false,
      schema: TZ_SCHEMA,
      extra: { max: 1, options: '-c TimeZone=UTC' },
    });
    await dataSource.initialize();

    await dataSource.query(`DROP SCHEMA IF EXISTS "${TZ_SCHEMA}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${TZ_SCHEMA}"`);
    await dataSource.query(`
      CREATE TABLE ${tz('user')} ( "id" int PRIMARY KEY, "walletId" int NOT NULL, "created" TIMESTAMP NOT NULL DEFAULT NOW() );
      CREATE TABLE ${tz('buy')} ( "id" int PRIMARY KEY, "userId" int NOT NULL );
      CREATE TABLE ${tz('buy_crypto')} (
        "id" SERIAL PRIMARY KEY,
        "buyId" int,
        "amountInChf" numeric DEFAULT 0,
        "amlCheck" varchar(64),
        "created" TIMESTAMP NOT NULL
      );
    `);

    // Wall-clock values stored as-is (timestamp without time zone) — these are the UTC
    // instants the production Dockerfile (ENV TZ=UTC) would have written.
    await dataSource.query(`
      INSERT INTO ${tz('user')} ("id", "walletId", "created") VALUES (1, 1, '2024-06-01 10:00:00');
      INSERT INTO ${tz('buy')} ("id", "userId") VALUES (1, 1);
      INSERT INTO ${tz('buy_crypto')} ("buyId", "amountInChf", "amlCheck", "created")
      VALUES
        (1, 100, 'Pass', '2024-06-10 10:00:00'),
        (1, 100, 'Pass', '2024-06-11 10:00:00');
    `);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${TZ_SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('bucket keys stay on true UTC day boundaries in a child process running under Asia/Tokyo', () => {
    const scriptPath = path.join(__dirname, 'partner-statistic-tz-check.script.ts');
    const stdout = execFileSync(
      path.join(process.cwd(), 'node_modules', '.bin', 'ts-node'),
      ['-T', '-r', 'tsconfig-paths/register', scriptPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, TZ: CHECK_TZ, MIGRATION_TEST_PG: PG_URL, TZ_CHECK_SCHEMA: TZ_SCHEMA },
        encoding: 'utf-8',
      },
    );

    const resultLine = stdout.split('\n').find((line) => line.startsWith('TZ_CHECK_RESULT:'));
    if (!resultLine) throw new Error(`TZ check script produced no result line. stdout was:\n${stdout}`);
    const bucketKeys: string[] = JSON.parse(resultLine.slice('TZ_CHECK_RESULT:'.length));

    // Without `AT TIME ZONE 'UTC'`, the driver would parse the DATE_TRUNC'd `timestamp without
    // time zone` result in process-local wall time (Asia/Tokyo, UTC+9) — midnight Tokyo time is
    // the previous day in UTC, so the bucket key would land one calendar day too early.
    expect(bucketKeys).toEqual(['2024-06-10T00:00:00', '2024-06-11T00:00:00']);
  });
});
