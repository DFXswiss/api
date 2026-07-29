import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'binance_custody_assets_ondo_ada_spec';

let AddBinanceCustodyAssetsOndoAda: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddBinanceCustodyAssetsOndoAda migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddBinanceCustodyAssetsOndoAda = require('../../../../../migration/1785320000000-AddBinanceCustodyAssetsOndoAda');
  });

  it('is idempotent: both assets already exist → no INSERT calls', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "asset"') && s.includes(`'ethereum/ondo'`)) return [{ id: 1 }];
        if (s.includes('from "asset"') && s.includes(`'binance/ondo'`)) return [{ id: 10 }];
        if (s.includes('from "asset"') && s.includes(`'cardano/ada'`)) return [{ id: 2 }];
        if (s.includes('from "asset"') && s.includes(`'binance/ada'`)) return [{ id: 11 }];
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls[0][0].toLowerCase()).toContain('pg_advisory_xact_lock');
    expect(calls.some(([statement]) => statement.toLowerCase().includes('insert'))).toBe(false);
  });

  it('inserts both Custody assets with single price-source subqueries, no COALESCE, no decimals/sortOrder', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        // price sources present
        if (s.includes('from "asset"') && s.includes(`'ethereum/ondo'`) && !s.includes('insert')) {
          return [{ id: 1 }];
        }
        if (s.includes('from "asset"') && s.includes(`'cardano/ada'`) && !s.includes('insert')) {
          return [{ id: 2 }];
        }
        // idempotency: neither custody row exists yet
        if (s.includes('from "asset"') && s.includes(`'binance/ondo'`) && !s.includes('insert')) {
          return [];
        }
        if (s.includes('from "asset"') && s.includes(`'binance/ada'`) && !s.includes('insert')) {
          return [];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    const sql = calls.map(([statement]) => statement).join('\n');

    // Every query must be single-argument (no bound parameter arrays)
    for (const call of calls) {
      expect(call).toHaveLength(1);
    }

    // Advisory lock must be the very first call (serializes concurrent multi-instance starts)
    expect(calls[0][0]).toContain('pg_advisory_xact_lock(1785320000000)');
    expect(sql).toContain(`'ONDO'`);
    expect(sql).toContain(`'Binance/ONDO'`);
    expect(sql).toContain(`'ADA'`);
    expect(sql).toContain(`'Binance/ADA'`);
    expect(sql).toContain(`'Custody'`);
    expect(sql).toContain(`'Private'`);
    expect(sql).toContain(`'Binance'`);
    expect(sql).toContain(`'Other'`);
    expect(sql).toContain(`(SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO')`);
    expect(sql).toContain(`(SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO')`);
    expect(sql).toContain(`(SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO')`);
    expect(sql).toContain(`(SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO')`);
    expect(sql).toContain(`(SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA')`);
    expect(sql).toContain(`(SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA')`);
    expect(sql).toContain(`(SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA')`);
    expect(sql).toContain(`(SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA')`);
    expect(sql).not.toContain('COALESCE');
    expect(sql).not.toContain('"decimals"');
    expect(sql).not.toContain('"sortOrder"');
    // refundEnabled must be explicit false (entity default is true)
    expect(sql).toMatch(/"refundEnabled"[\s\S]*false/);
  });

  it('throws when Ethereum/ONDO price source is missing and does not INSERT', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "asset"') && s.includes(`'ethereum/ondo'`)) return [];
        return [];
      }),
    };

    await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'Cannot create Binance/ONDO custody asset: price source Ethereum/ONDO not found',
    );

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls[0][0].toLowerCase()).toContain('pg_advisory_xact_lock');
    expect(calls.some(([statement]) => statement.toLowerCase().includes('insert'))).toBe(false);
  });

  it('throws when Cardano/ADA price source is missing and does not INSERT (ONDO already present)', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        // ONDO path: price source ok, custody row already exists → skip INSERT
        if (s.includes('from "asset"') && s.includes(`'ethereum/ondo'`)) return [{ id: 1 }];
        if (s.includes('from "asset"') && s.includes(`'binance/ondo'`)) return [{ id: 10 }];
        // ADA path: price source missing
        if (s.includes('from "asset"') && s.includes(`'cardano/ada'`)) return [];
        return [];
      }),
    };

    await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'Cannot create Binance/ADA custody asset: price source Cardano/ADA not found',
    );

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls[0][0].toLowerCase()).toContain('pg_advisory_xact_lock');
    expect(calls.some(([statement]) => statement.toLowerCase().includes('insert'))).toBe(false);
  });
});

describeDb('AddBinanceCustodyAssetsOndoAda migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddBinanceCustodyAssetsOndoAda = require('../../../../../migration/1785320000000-AddBinanceCustodyAssetsOndoAda');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // Minimal fixture table — columns the migration touches, plus decimals/sortOrder so the
    // post-condition NULL checks below have columns to assert against. refundEnabled mirrors
    // the real entity default (true) so omitting it from INSERT would silently get the wrong value.
    await queryRunner.query(`
      CREATE TABLE "asset" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "name" varchar(256) NOT NULL,
        "uniqueName" varchar(256) NOT NULL,
        "type" varchar(256) NOT NULL,
        "blockchain" varchar(256) NOT NULL,
        "category" varchar(256) NOT NULL DEFAULT 'Public',
        "dexName" varchar(256),
        "financialType" varchar(256),
        "buyable" boolean NOT NULL DEFAULT true,
        "sellable" boolean NOT NULL DEFAULT true,
        "cardBuyable" boolean NOT NULL DEFAULT true,
        "cardSellable" boolean NOT NULL DEFAULT true,
        "instantBuyable" boolean NOT NULL DEFAULT true,
        "instantSellable" boolean NOT NULL DEFAULT true,
        "paymentEnabled" boolean NOT NULL DEFAULT false,
        "refEnabled" boolean NOT NULL DEFAULT false,
        "refundEnabled" boolean NOT NULL DEFAULT true,
        "ikna" boolean NOT NULL DEFAULT false,
        "personalIbanEnabled" boolean NOT NULL DEFAULT false,
        "comingSoon" boolean NOT NULL DEFAULT false,
        "decimals" integer,
        "sortOrder" integer,
        "priceRuleId" integer,
        "approxPriceChf" double precision,
        "approxPriceEur" double precision,
        "approxPriceUsd" double precision
      )
    `);

    // Price-source fixtures.
    await queryRunner.query(`
      INSERT INTO "asset"
        ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
         "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
         "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
         "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
      VALUES
        ('ONDO', 'Ethereum/ONDO', 'Token', 'Ethereum', 'Public', 'ONDO', 'Other',
         true, true, true, true, true, true, false, false, true, false, false, false,
         98, 0.8, 0.85, 1.0),
        ('ADA', 'Cardano/ADA', 'Coin', 'Cardano', 'Public', 'ADA', 'Other',
         true, true, true, true, true, true, false, false, true, false, false, false,
         63, 0.2753489034, 0.2964721043, 0.3492050313)
    `);
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('creates Binance/ONDO and Binance/ADA priced off their sources, flags false', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    await migration.up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "name", "uniqueName", "type", "category", "blockchain", "dexName", "financialType",
              "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
              "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
              "decimals", "sortOrder", "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd"
       FROM "asset" WHERE "uniqueName" IN ('Binance/ONDO', 'Binance/ADA') ORDER BY "uniqueName"`,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'ADA',
      uniqueName: 'Binance/ADA',
      type: 'Custody',
      category: 'Private',
      blockchain: 'Binance',
      dexName: 'ADA',
      financialType: 'Other',
      buyable: false,
      sellable: false,
      cardBuyable: false,
      cardSellable: false,
      instantBuyable: false,
      instantSellable: false,
      paymentEnabled: false,
      refEnabled: false,
      refundEnabled: false,
      ikna: false,
      personalIbanEnabled: false,
      comingSoon: false,
      priceRuleId: 63,
      approxPriceChf: 0.2753489034,
      approxPriceEur: 0.2964721043,
      approxPriceUsd: 0.3492050313,
    });
    expect(rows[0].decimals).toBeNull();
    expect(rows[0].sortOrder).toBeNull();

    expect(rows[1]).toMatchObject({
      name: 'ONDO',
      uniqueName: 'Binance/ONDO',
      type: 'Custody',
      category: 'Private',
      blockchain: 'Binance',
      dexName: 'ONDO',
      financialType: 'Other',
      buyable: false,
      sellable: false,
      cardBuyable: false,
      cardSellable: false,
      instantBuyable: false,
      instantSellable: false,
      paymentEnabled: false,
      refEnabled: false,
      refundEnabled: false,
      ikna: false,
      personalIbanEnabled: false,
      comingSoon: false,
      priceRuleId: 98,
      approxPriceChf: 0.8,
      approxPriceEur: 0.85,
      approxPriceUsd: 1.0,
    });
    expect(rows[1].decimals).toBeNull();
    expect(rows[1].sortOrder).toBeNull();
  });

  it('is idempotent: re-running up() does not create duplicate rows', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const count = (
      await queryRunner.query(
        `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Binance/ONDO', 'Binance/ADA')`,
      )
    )[0].c;

    expect(count).toBe(2);
  });

  it('down() removes both custody rows and leaves price sources untouched', async () => {
    const migration = new AddBinanceCustodyAssetsOndoAda();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const custody = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Binance/ONDO', 'Binance/ADA')`,
    );
    const sources = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Ethereum/ONDO', 'Cardano/ADA')`,
    );

    expect(custody[0].c).toBe(0);
    expect(sources[0].c).toBe(2);
  });

  it('throws when Ethereum/ONDO is missing and leaves no custody rows', async () => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'`);

    const migration = new AddBinanceCustodyAssetsOndoAda();
    await expect(migration.up(queryRunner)).rejects.toThrow(
      'Cannot create Binance/ONDO custody asset: price source Ethereum/ONDO not found',
    );

    const rows = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Binance/ONDO', 'Binance/ADA')`,
    );
    expect(rows[0].c).toBe(0);
  });

  it('throws when Cardano/ADA is missing and does not insert Binance/ADA', async () => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'`);

    const migration = new AddBinanceCustodyAssetsOndoAda();
    await expect(migration.up(queryRunner)).rejects.toThrow(
      'Cannot create Binance/ADA custody asset: price source Cardano/ADA not found',
    );

    // ONDO is inserted before the ADA guard runs; ADA must not exist. This asserts up()'s
    // internal order / fail-fast on a non-transactional QueryRunner (this suite's beforeEach
    // never calls startTransaction(), so the insert auto-commits). The partial state seen here
    // (ONDO present, ADA guard throwing) is never visible on disk in production: real deploys
    // run migrations inside TypeORM's migration transaction (migrationsRun in
    // src/config/config.ts; no migrationsTransactionMode override → default 'all'), so the
    // whole batch is one transaction and a throw at the ADA guard rolls the ONDO insert back.
    const ondo = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Binance/ONDO'`);
    const ada = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Binance/ADA'`);
    expect(ondo[0].c).toBe(1);
    expect(ada[0].c).toBe(0);
  });

  it('target already exists but its price source was removed: up() resolves without throwing and does not insert a duplicate', async () => {
    // Simulate a pre-existing Binance/ONDO row (as if a previous, successful run already
    // created it) whose price source has since been renamed/removed.
    await queryRunner.query(`
      INSERT INTO "asset"
        ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
         "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
         "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
         "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
      VALUES
        ('ONDO', 'Binance/ONDO', 'Custody', 'Binance', 'Private', 'ONDO', 'Other',
         false, false, false, false, false, false,
         false, false, false, false, false, false,
         98, 0.8, 0.85, 1.0)
    `);
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'`);

    const migration = new AddBinanceCustodyAssetsOndoAda();
    await expect(migration.up(queryRunner)).resolves.toBeUndefined();

    const ondo = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Binance/ONDO'`);
    expect(ondo[0].c).toBe(1);

    // ADA is unaffected by ONDO's missing price source — each asset's existence check and
    // price-source guard are independent, so ADA is still created normally.
    const ada = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Binance/ADA'`);
    expect(ada[0].c).toBe(1);
  });
});
