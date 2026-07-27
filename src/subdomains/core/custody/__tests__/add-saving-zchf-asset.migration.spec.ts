import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'saving_zchf_asset_spec';

let AddSavingZchfAsset: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddSavingZchfAsset migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddSavingZchfAsset = require('../../../../../migration/1785192244267-AddSavingZchfAsset');
  });

  it('is idempotent: aborts without further queries when Ethereum/sZCHF already exists', async () => {
    const migration = new AddSavingZchfAsset();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "asset"') && s.includes(`'ethereum/szchf'`)) {
          return [{ id: 99 }];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    // Only the idempotency check must run — no price-source lookup, no INSERT.
    expect(calls).toHaveLength(1);
    expect(calls[0][0].toLowerCase()).toContain(`'ethereum/szchf'`);
  });

  it('inserts sZCHF priced 1:1 off Ethereum/ZCHF via subquery, no COALESCE, no on-chain columns', async () => {
    const migration = new AddSavingZchfAsset();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        // idempotency check: sZCHF does not exist yet
        if (s.includes('from "asset"') && s.includes(`'ethereum/szchf'`) && !s.includes('insert')) {
          return [];
        }
        // price-source check: Ethereum/ZCHF exists
        if (s.includes('from "asset"') && s.includes(`'ethereum/zchf'`) && !s.includes('insert')) {
          return [{ id: 1 }];
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

    expect(sql).toContain(`'sZCHF'`);
    expect(sql).toContain(`'Ethereum/sZCHF'`);
    expect(sql).toContain(`'Saving ZCHF'`);
    expect(sql).toContain(`'Custody'`);
    expect(sql).toContain(`'Private'`);
    expect(sql).toContain(`'Ethereum'`);
    expect(sql).toContain(`'CHF'`);
    expect(sql).toContain(`(SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')`);
    expect(sql).toContain(`(SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')`);
    expect(sql).toContain(`(SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')`);
    expect(sql).toContain(`(SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')`);
    expect(sql).not.toContain('COALESCE');
    expect(sql).not.toContain('"decimals"');
    expect(sql).not.toContain('"chainId"');
    expect(sql).not.toContain('"sortOrder"');
    expect(sql).not.toContain('"amlRuleFrom"');
    expect(sql).not.toContain('"amlRuleTo"');
  });

  it('throws when Ethereum/ZCHF price source is missing and does not INSERT', async () => {
    const migration = new AddSavingZchfAsset();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "asset"') && s.includes(`'ethereum/szchf'`)) return [];
        if (s.includes('from "asset"') && s.includes(`'ethereum/zchf'`)) return [];
        return [];
      }),
    };

    await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'Cannot create Ethereum/sZCHF custody asset: price source Ethereum/ZCHF not found',
    );

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls.some(([statement]) => statement.toLowerCase().includes('insert'))).toBe(false);
  });
});

describeDb('AddSavingZchfAsset migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddSavingZchfAsset = require('../../../../../migration/1785192244267-AddSavingZchfAsset');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // Minimal fixture table — the columns the migration touches, plus decimals/chainId/
    // sortOrder/amlRuleFrom/amlRuleTo so the post-condition NULL checks below have columns
    // to assert against (the migration itself never sets them).
    await queryRunner.query(`
      CREATE TABLE "asset" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "name" varchar(256) NOT NULL,
        "uniqueName" varchar(256) NOT NULL,
        "description" varchar(256),
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
        "chainId" varchar(256),
        "sortOrder" integer,
        "priceRuleId" integer,
        "approxPriceChf" double precision,
        "approxPriceEur" double precision,
        "approxPriceUsd" double precision,
        "amlRuleFrom" integer,
        "amlRuleTo" integer
      )
    `);

    // Price-source fixture that sZCHF is priced 1:1 off.
    await queryRunner.query(`
      INSERT INTO "asset"
        ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
         "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
         "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
         "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
      VALUES
        ('ZCHF', 'Ethereum/ZCHF', 'Token', 'Ethereum', 'Public', 'ZCHF', 'CHF',
         true, true, true, true, true, true, false, false, true, false, false, false,
         170, 1, 1.076714309, 1.268227427)
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

  it('creates Ethereum/sZCHF priced 1:1 off Ethereum/ZCHF, all flags false, no on-chain columns', async () => {
    const migration = new AddSavingZchfAsset();
    await migration.up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "name", "uniqueName", "description", "type", "category", "blockchain", "dexName", "financialType",
              "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
              "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
              "decimals", "chainId", "sortOrder", "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd"
       FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'sZCHF',
      uniqueName: 'Ethereum/sZCHF',
      description: 'Saving ZCHF',
      type: 'Custody',
      category: 'Private',
      blockchain: 'Ethereum',
      dexName: 'sZCHF',
      financialType: 'CHF',
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
      priceRuleId: 170,
      approxPriceChf: 1,
      approxPriceEur: 1.076714309,
      approxPriceUsd: 1.268227427,
    });
    expect(rows[0].decimals).toBeNull();
    expect(rows[0].chainId).toBeNull();
    expect(rows[0].sortOrder).toBeNull();
  });

  it('is idempotent: re-running up() does not create a second row', async () => {
    const migration = new AddSavingZchfAsset();
    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const count = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`)
    )[0].c;

    expect(count).toBe(1);
  });

  it('down() removes the sZCHF row and leaves Ethereum/ZCHF untouched', async () => {
    const migration = new AddSavingZchfAsset();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const szchf = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`,
    );
    const zchf = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'`);

    expect(szchf[0].c).toBe(0);
    expect(zchf[0].c).toBe(1);
  });

  it('throws when Ethereum/ZCHF is missing and leaves no sZCHF row', async () => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'`);

    const migration = new AddSavingZchfAsset();
    await expect(migration.up(queryRunner)).rejects.toThrow(
      'Cannot create Ethereum/sZCHF custody asset: price source Ethereum/ZCHF not found',
    );

    const rows = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`,
    );
    expect(rows[0].c).toBe(0);
  });
});
