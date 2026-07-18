import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'frick_custody_assets_spec';

let AddBankFrickCustodyAssets: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

/** Prod-gate the migration under test; restore the original ENVIRONMENT afterward. */
function withPrdEnv() {
  const originalEnv = process.env.ENVIRONMENT;
  beforeEach(() => {
    process.env.ENVIRONMENT = 'prd';
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
  });
}

describe('AddBankFrickCustodyAssets migration (SQL content)', () => {
  withPrdEnv();

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddBankFrickCustodyAssets = require('../../../../../../migration/1784500000000-AddBankFrickCustodyAssets');
  });

  it('creates observe-only LM rules (no minimal/maximal/action FKs) and never overwrites non-null assetId', async () => {
    const migration = new AddBankFrickCustodyAssets();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        // price-source COUNT guard — report sources present
        if (s.includes('count(*)') && s.includes('yapeal/eur')) {
          return [{ n: 1 }];
        }
        if (s.includes('count(*)') && s.includes('yapeal/chf')) {
          return [{ n: 1 }];
        }
        // idempotency: assets do not exist yet
        if (s.includes('from "asset"') && s.includes(`'frick/eur'`) && !s.includes('insert')) {
          return [];
        }
        if (s.includes('from "asset"') && s.includes(`'frick/chf'`) && !s.includes('insert')) {
          return [];
        }
        // unlinked check passes
        if (s.includes('from "bank"') && s.includes('assetid" is null')) {
          return [];
        }
        // LM rule does not exist yet
        if (s.includes('from "liquidity_management_rule"')) {
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

    expect(sql).toContain(`SET LOCAL lock_timeout = '5s'`);
    // uniqueName / currency are inlined SQL literals
    expect(sql).toContain(`'Frick/EUR'`);
    expect(sql).toContain(`'Frick/CHF'`);
    expect(sql).toContain(`COALESCE(`);
    expect(sql).toContain(`'Yapeal/EUR'`);
    expect(sql).toContain(`'Olkypay/EUR'`);
    expect(sql).toContain(`INSERT INTO "liquidity_management_rule" ("context", "status", "targetAssetId")`);
    expect(sql).toContain(`'Bank Frick'`);
    expect(sql).toContain(`'Active'`);
    expect(sql).toContain(`(SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/EUR')`);
    // Observe-only: INSERT must not set minimal/maximal/action columns
    expect(sql).not.toMatch(/INSERT INTO "liquidity_management_rule"[^;]*"minimal"/i);
    expect(sql).not.toMatch(/INSERT INTO "liquidity_management_rule"[^;]*"maximal"/i);
    expect(sql).not.toMatch(/INSERT INTO "liquidity_management_rule"[^;]*deficitStartActionId/i);
    // Bank link is NULL-only fill
    expect(sql).toContain(`"assetId" IS NULL`);
  });

  it('throws when neither Yapeal nor Olkypay price source exists', async () => {
    const migration = new AddBankFrickCustodyAssets();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('lock_timeout')) return undefined;
        if (sql.toLowerCase().includes('count(*)')) return [{ n: 0 }];
        return [];
      }),
    };

    await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      /no price source found.*Yapeal\/EUR.*Olkypay\/EUR/,
    );
  });
});

describeDb('AddBankFrickCustodyAssets migration (real Postgres)', () => {
  withPrdEnv();

  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddBankFrickCustodyAssets = require('../../../../../../migration/1784500000000-AddBankFrickCustodyAssets');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // Minimal fixture tables — only the columns the migration touches.
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
        "priceRuleId" integer,
        "approxPriceChf" double precision,
        "approxPriceEur" double precision,
        "approxPriceUsd" double precision
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "bank" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "name" varchar(256) NOT NULL,
        "iban" varchar(256) NOT NULL,
        "bic" varchar(256) NOT NULL,
        "currency" varchar(256) NOT NULL,
        "receive" boolean NOT NULL DEFAULT true,
        "send" boolean NOT NULL DEFAULT true,
        "sctInst" boolean NOT NULL DEFAULT false,
        "amlEnabled" boolean NOT NULL DEFAULT true,
        "assetId" integer UNIQUE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "liquidity_management_rule" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "context" varchar(256),
        "status" varchar(256),
        "minimal" double precision,
        "optimal" double precision,
        "maximal" double precision,
        "limit" double precision,
        "reactivationTime" integer,
        "delayActivation" boolean NOT NULL DEFAULT true,
        "sendNotifications" boolean NOT NULL DEFAULT true,
        "targetAssetId" integer,
        "targetFiatId" integer,
        "deficitStartActionId" integer,
        "redundancyStartActionId" integer
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_245ccaa266891c0346b2ddb62f"
      ON "liquidity_management_rule" ("context", "targetAssetId", "targetFiatId")
    `);

    // Price-source fixtures (Yapeal EUR/CHF).
    await queryRunner.query(`
      INSERT INTO "asset"
        ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
         "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
         "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
         "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
      VALUES
        ('EUR', 'Yapeal/EUR', 'Custody', 'Yapeal', 'Private', 'EUR', 'EUR',
         false, false, false, false, false, false, false, false, true, false, false, false,
         39, 0.9287514723, 1, 1.17786809),
        ('CHF', 'Yapeal/CHF', 'Custody', 'Yapeal', 'Private', 'CHF', 'CHF',
         false, false, false, false, false, false, false, false, true, false, false, false,
         37, 1, 1.076714309, 1.268227427)
    `);

    // Active Bank Frick EUR/CHF pair with assetId IS NULL (prod-activated shape).
    await queryRunner.query(`
      INSERT INTO "bank" ("name", "iban", "bic", "currency", "receive", "send", "assetId")
      VALUES
        ('Bank Frick', 'LI75088110105923K000E', 'BFRILI22', 'EUR', true, true, NULL),
        ('Bank Frick', 'LI32088110105923K000C', 'BFRILI22', 'CHF', true, true, NULL)
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

  it('creates Frick assets with copied prices, links banks, and inserts observe-only LM rules', async () => {
    const migration = new AddBankFrickCustodyAssets();
    await migration.up(queryRunner);

    const assets = await queryRunner.query(
      `SELECT "uniqueName", "blockchain", "dexName", "financialType", "type", "priceRuleId",
              "approxPriceChf", "approxPriceEur", "approxPriceUsd", "buyable", "sellable", "refundEnabled"
       FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF') ORDER BY "uniqueName"`,
    );
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      uniqueName: 'Frick/CHF',
      blockchain: 'Frick',
      dexName: 'CHF',
      financialType: 'CHF',
      type: 'Custody',
      priceRuleId: 37,
      approxPriceChf: 1,
      approxPriceEur: 1.076714309,
      approxPriceUsd: 1.268227427,
      buyable: false,
      sellable: false,
      refundEnabled: true,
    });
    expect(assets[1]).toMatchObject({
      uniqueName: 'Frick/EUR',
      blockchain: 'Frick',
      dexName: 'EUR',
      financialType: 'EUR',
      type: 'Custody',
      priceRuleId: 39,
      approxPriceChf: 0.9287514723,
      approxPriceEur: 1,
      approxPriceUsd: 1.17786809,
      buyable: false,
      sellable: false,
      refundEnabled: true,
    });

    const frickEurId = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/EUR'`))[0]
      .id as number;
    const frickChfId = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/CHF'`))[0]
      .id as number;

    const banks = await queryRunner.query(
      `SELECT "currency", "assetId" FROM "bank" WHERE "name" = 'Bank Frick' ORDER BY "currency"`,
    );
    expect(banks).toEqual([
      { currency: 'CHF', assetId: frickChfId },
      { currency: 'EUR', assetId: frickEurId },
    ]);

    const rules = await queryRunner.query(
      `SELECT "context", "status", "targetAssetId", "targetFiatId", "minimal", "maximal",
              "deficitStartActionId", "redundancyStartActionId"
       FROM "liquidity_management_rule" WHERE "context" = 'Bank Frick' ORDER BY "targetAssetId"`,
    );
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.context).toBe('Bank Frick');
      expect(rule.status).toBe('Active');
      expect(rule.targetFiatId).toBeNull();
      expect(rule.minimal).toBeNull();
      expect(rule.maximal).toBeNull();
      expect(rule.deficitStartActionId).toBeNull();
      expect(rule.redundancyStartActionId).toBeNull();
    }
    expect(rules.map((r: { targetAssetId: number }) => r.targetAssetId).sort()).toEqual(
      [frickEurId, frickChfId].sort(),
    );
  });

  it('is idempotent: re-running up() does not error or duplicate assets/rules', async () => {
    const migration = new AddBankFrickCustodyAssets();
    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const assetCount = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF')`)
    )[0].c;
    const ruleCount = (
      await queryRunner.query(
        `SELECT COUNT(*)::int AS c FROM "liquidity_management_rule" WHERE "context" = 'Bank Frick'`,
      )
    )[0].c;

    expect(assetCount).toBe(2);
    expect(ruleCount).toBe(2);
  });

  it('throws when an active Frick bank row cannot be linked (fail-loud post-condition)', async () => {
    // Active Frick USD row: the migration only creates EUR/CHF assets, so the bank UPDATE leaves
    // this row with assetId NULL and the post-condition must throw rather than half-wire.
    await queryRunner.query(`
      INSERT INTO "bank" ("name", "iban", "bic", "currency", "receive", "send", "assetId")
      VALUES ('Bank Frick', 'LI0000000FRICKUSD0001', 'BFRILI22', 'USD', true, true, NULL)
    `);

    const migration = new AddBankFrickCustodyAssets();
    await expect(migration.up(queryRunner)).rejects.toThrow('Bank Frick custody-asset wiring incomplete');
  });

  it('down() reverses cleanly (rules deleted, bank unlinked, assets deleted)', async () => {
    const migration = new AddBankFrickCustodyAssets();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const assets = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF')`,
    );
    const rules = await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM "liquidity_management_rule" WHERE "context" = 'Bank Frick'`,
    );
    const banks = await queryRunner.query(
      `SELECT "assetId" FROM "bank" WHERE "name" = 'Bank Frick' AND "currency" IN ('EUR', 'CHF')`,
    );

    expect(assets[0].c).toBe(0);
    expect(rules[0].c).toBe(0);
    expect(banks.every((b: { assetId: number | null }) => b.assetId == null)).toBe(true);
  });
});
