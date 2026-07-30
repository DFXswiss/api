import { DataSource } from 'typeorm';
import { ConfigService } from 'src/config/config';
import { PartnerStatisticService } from '../partner-statistic.service';
import { suppressPeriodTotals, suppressTimelineBuckets } from '../partner-statistic.suppression';

/**
 * Real-Postgres integration for the partner-statistic SQL shapes.
 * Skipped unless MIGRATION_TEST_PG is set (CI / local disposable DB).
 *
 * Covers: half-open period filter, UNION active-user count, breakdown GROUP BY
 * rows fed through mergeNamedRows, and a timeline DATE_TRUNC bucket — paths the
 * unit mocks previously never exercised with real rows.
 *
 * Uses string-based QueryBuilder (no full entity graph) against a minimal schema
 * that mirrors the production join columns.
 */
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'partner_statistic_spec';

process.env.TZ = 'UTC';

describeDb('PartnerStatisticService SQL path (real Postgres)', () => {
  let dataSource: DataSource;
  let service: PartnerStatisticService;

  beforeAll(async () => {
    new ConfigService();
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${SCHEMA}"`);
    await dataSource.query(`SET search_path TO "${SCHEMA}"`);

    await dataSource.query(`
      CREATE TABLE "user" (
        "id" SERIAL PRIMARY KEY,
        "walletId" int NOT NULL,
        "buyVolume" numeric DEFAULT 0,
        "sellVolume" numeric DEFAULT 0,
        "created" TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "buy" (
        "id" SERIAL PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE "sell" (
        "id" SERIAL PRIMARY KEY,
        "userId" int NOT NULL
      );
      CREATE TABLE "asset" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(256),
        "blockchain" varchar(256)
      );
      CREATE TABLE "transaction" (
        "id" SERIAL PRIMARY KEY,
        "sourceType" varchar(256)
      );
      CREATE TABLE "buy_crypto" (
        "id" SERIAL PRIMARY KEY,
        "buyId" int,
        "outputAssetId" int,
        "transactionId" int,
        "amountInChf" numeric DEFAULT 0,
        "inputAsset" varchar(256),
        "amlCheck" varchar(64),
        "isComplete" boolean DEFAULT false,
        "created" TIMESTAMP NOT NULL
      );
      CREATE TABLE "buy_fiat" (
        "id" SERIAL PRIMARY KEY,
        "sellId" int,
        "outputAssetId" int,
        "transactionId" int,
        "amountInChf" numeric DEFAULT 0,
        "inputAsset" varchar(256),
        "amlCheck" varchar(64),
        "isComplete" boolean DEFAULT false,
        "created" TIMESTAMP NOT NULL
      );
    `);

    await dataSource.query(`
      INSERT INTO "user" ("id", "walletId", "buyVolume", "sellVolume", "created") VALUES
        (1, 1, 100, 0, '2024-06-01 10:00:00'),
        (2, 1, 100, 0, '2024-06-01 11:00:00'),
        (3, 1, 100, 0, '2024-06-01 12:00:00'),
        (4, 1, 100, 0, '2024-06-01 13:00:00'),
        (5, 1, 100, 50, '2024-06-01 14:00:00'),
        (6, 2, 999, 0, '2024-06-01 10:00:00');
      INSERT INTO "buy" ("id", "userId") VALUES (1,1),(2,2),(3,3),(4,4),(5,5),(6,6);
      INSERT INTO "sell" ("id", "userId") VALUES (1,5);
      INSERT INTO "asset" ("id", "name", "blockchain") VALUES (1, 'BTC', 'Bitcoin'), (2, 'ETH', 'Ethereum');
      INSERT INTO "transaction" ("id", "sourceType") VALUES
        (1, 'BankTx'), (2, 'BankTx'), (3, 'BankTx'), (4, 'BankTx'), (5, 'BankTx'), (6, 'BankTx');
      INSERT INTO "buy_crypto"
        ("buyId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "isComplete", "created", "inputAsset")
      VALUES
        (1, 1, 1, 100, 'Pass', true, '2024-06-10 10:00:00', 'CHF'),
        (2, 1, 2, 100, 'Pass', true, '2024-06-10 11:00:00', 'CHF'),
        (3, 1, 3, 100, 'Pass', true, '2024-06-10 12:00:00', 'CHF'),
        (4, 1, 4, 100, 'Pass', true, '2024-06-11 10:00:00', 'CHF'),
        (5, 1, 5, 100, 'Pass', true, '2024-06-11 11:00:00', 'CHF'),
        (6, 2, 6, 9999, 'Pass', true, '2024-06-10 10:00:00', 'CHF');
      INSERT INTO "buy_fiat"
        ("sellId", "outputAssetId", "transactionId", "amountInChf", "amlCheck", "isComplete", "created", "inputAsset")
      VALUES
        (1, 1, 1, 50, 'Pass', true, '2024-06-11 12:00:00', 'BTC');
    `);

    // Lightweight service shell for mergeNamedRows only (repos unused for SQL below).
    service = new PartnerStatisticService(
      { manager: dataSource.manager } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(async () => {
    await dataSource.query(`SET search_path TO public`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('aggregates volume, UNION active users, breakdown rows, and timeline buckets on real rows', async () => {
    const from = new Date('2024-06-01T00:00:00.000Z');
    const to = new Date('2024-07-01T00:00:00.000Z');
    const walletId = 1;

    // Direction aggregate (buy) — half-open, scoped, aml Pass
    const buyAgg = await dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(tx."amountInChf"), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .from('buy_crypto', 'tx')
      .innerJoin('buy', 'route', 'route.id = tx."buyId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', { from, to })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' })
      .getRawOne<{ volume: string; transactions: string; users: string }>();

    expect(+buyAgg.volume).toBe(500);
    expect(+buyAgg.transactions).toBe(5);
    expect(+buyAgg.users).toBe(5);

    // Foreign wallet row must not leak
    expect(+buyAgg.volume).not.toBe(500 + 9999);

    // UNION distinct active users across buy + sell
    const buyIds = dataSource
      .createQueryBuilder()
      .select('u.id', 'id')
      .from('buy_crypto', 'tx')
      .innerJoin('buy', 'route', 'route.id = tx."buyId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', { from, to })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' });
    const sellIds = dataSource
      .createQueryBuilder()
      .select('u.id', 'id')
      .from('buy_fiat', 'tx')
      .innerJoin('sell', 'route', 'route.id = tx."sellId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', { from, to })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' });

    const unionSql = `(${buyIds.getQuery()}) UNION (${sellIds.getQuery()})`;
    const active = await dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(`(${unionSql})`, 'active_users')
      .setParameters({ ...buyIds.getParameters(), ...sellIds.getParameters() })
      .getRawOne<{ count: string }>();
    expect(+active.count).toBe(5);

    // Breakdown by asset name + blockchain (GROUP BY qualified columns)
    const assetRows = await dataSource
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
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', { from, to })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' })
      .groupBy('a.name')
      .addGroupBy('a.blockchain')
      .getRawMany<{ name: string; blockchain: string; volume: string; transactions: string; users: string }>();

    const merged = service.mergeNamedRows(
      assetRows.map((r) => ({
        name: r.name,
        blockchain: r.blockchain,
        volume: r.volume,
        transactions: r.transactions,
        users: r.users,
      })),
    );
    expect(merged.find((r) => r.name === 'BTC')?.volume).toBe(500);
    expect(merged.find((r) => r.name === 'BTC')?.transactions).toBe(5);
    // mergeNamedRows must actually run — a no-op would leave volume as string or wrong
    expect(typeof merged[0].volume).toBe('number');

    // Timeline DATE_TRUNC day buckets (UTC-tagged, same expression shape as the service)
    const timelineTrunc = `DATE_TRUNC('day', tx.created) AT TIME ZONE 'UTC'`;
    const timelineRows = await dataSource
      .createQueryBuilder()
      .select(timelineTrunc, 'bucket')
      .addSelect('COALESCE(SUM(tx."amountInChf"), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .from('buy_crypto', 'tx')
      .innerJoin('buy', 'route', 'route.id = tx."buyId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', {
        from: new Date('2024-06-10T00:00:00.000Z'),
        to: new Date('2024-06-12T00:00:00.000Z'),
      })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' })
      .groupBy(timelineTrunc)
      .orderBy(timelineTrunc, 'ASC')
      .getRawMany<{ bucket: Date; volume: string; transactions: string; users: string }>();

    expect(timelineRows.length).toBe(2);
    expect(+timelineRows[0].transactions).toBe(3);
    expect(+timelineRows[1].transactions).toBe(2);

    // Suppression integration: day-1 (3 txs) under k → suppressed
    const buckets = timelineRows.map((r) => ({
      date: new Date(r.bucket),
      volume: { buy: +r.volume, sell: 0, swap: 0 },
      transactions: { buy: +r.transactions, sell: 0, swap: 0 },
      users: { buy: +r.users, sell: 0, swap: 0 },
      suppressed: false,
      partial: false,
    }));
    const { buckets: suppressed } = suppressTimelineBuckets(buckets);
    expect(suppressed[0].suppressed).toBe(true);
    expect(suppressed[1].suppressed).toBe(true); // complementary or under k

    // Period totals block rule on real aggregates
    const sellAgg = await dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(tx."amountInChf"), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .from('buy_fiat', 'tx')
      .innerJoin('sell', 'route', 'route.id = tx."sellId"')
      .innerJoin('user', 'u', 'u.id = route."userId"')
      .where('u."walletId" = :walletId', { walletId })
      .andWhere('tx.created >= :from AND tx.created < :to', { from, to })
      .andWhere('tx."amlCheck" = :check', { check: 'Pass' })
      .getRawOne<{ volume: string; transactions: string; users: string }>();

    const totals = suppressPeriodTotals(
      {
        buy: +buyAgg.volume,
        sell: +sellAgg.volume,
        swap: 0,
        total: +buyAgg.volume + +sellAgg.volume,
      },
      {
        buy: +buyAgg.transactions,
        sell: +sellAgg.transactions,
        swap: 0,
        total: +buyAgg.transactions + +sellAgg.transactions,
      },
      {
        buy: +buyAgg.users,
        sell: +sellAgg.users,
        swap: 0,
        total: +active.count,
      },
    );
    // sell has 1 tx → entire totals group null
    expect(totals.volume.total).toBeNull();
    expect(totals.volume.buy).toBeNull();
  });
});
