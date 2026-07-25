import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let AddDenarioWalletAndAssets: new () => Migration;

async function countAsset(queryRunner: QueryRunner, uniqueName: string): Promise<number> {
  const rows = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = '${uniqueName}'`);
  return rows.at(0).c;
}

async function countWallet(queryRunner: QueryRunner): Promise<number> {
  const rows = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "wallet" WHERE "name" = 'Denario'`);
  return rows.at(0).c;
}

async function insertInertAsset(queryRunner: QueryRunner, uniqueName: 'Polygon/DGC' | 'Polygon/DSC'): Promise<number> {
  const isDgc = uniqueName === 'Polygon/DGC';
  const rows = await queryRunner.query(
    `INSERT INTO "asset"
       ("name", "uniqueName", "type", "blockchain", "category", "dexName", "chainId", "decimals", "description",
        "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
     VALUES ($1, $2, 'Token', 'Polygon', 'Public', $1, $3, 8, $4,
        false, false, false, false, false, false,
        false, false, true, false, false, false)
     RETURNING "id"`,
    [
      isDgc ? 'DGC' : 'DSC',
      uniqueName,
      isDgc ? '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f' : '0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7',
      isDgc ? 'Denario Gold Coin' : 'Denario Silver Coin',
    ],
  );
  return rows.at(0).id;
}

// The migration under test is prod-gated (ENVIRONMENT === 'prd'); force it so up()/down() execute.
const originalEnvironment = process.env.ENVIRONMENT;
beforeEach(() => {
  process.env.ENVIRONMENT = 'prd';
});
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = originalEnvironment;
});

describe('AddDenarioWalletAndAssets migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioWalletAndAssets = require('../../../../../migration/1784994200000-AddDenarioWalletAndAssets');
  });

  beforeEach(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({ type: 'postgres', entities: [] })) as DataSource;
    await dataSource.initialize();

    await dataSource.query(`
      CREATE TABLE "asset" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "uniqueName" text NOT NULL,
        "type" text NOT NULL,
        "blockchain" text NOT NULL,
        "category" text NOT NULL,
        "dexName" text,
        "chainId" text,
        "decimals" integer,
        "description" text,
        "buyable" boolean NOT NULL,
        "sellable" boolean NOT NULL,
        "cardBuyable" boolean NOT NULL,
        "cardSellable" boolean NOT NULL,
        "instantBuyable" boolean NOT NULL,
        "instantSellable" boolean NOT NULL,
        "paymentEnabled" boolean NOT NULL,
        "refEnabled" boolean NOT NULL,
        "refundEnabled" boolean NOT NULL,
        "ikna" boolean NOT NULL,
        "personalIbanEnabled" boolean NOT NULL,
        "comingSoon" boolean NOT NULL,
        "priceRuleId" integer
      )
    `);
    await dataSource.query(`
      CREATE TABLE "wallet" (
        "id" serial PRIMARY KEY,
        "address" text,
        "name" text,
        "displayName" text,
        "isKycClient" boolean NOT NULL DEFAULT false,
        "displayFraudWarning" boolean NOT NULL DEFAULT false,
        "usesDummyAddresses" boolean NOT NULL DEFAULT false,
        "customKyc" text,
        "identMethod" text,
        "apiUrl" text,
        "apiKey" text,
        "amlRules" text NOT NULL DEFAULT '0',
        "exceptAmlRules" text,
        "webhookConfig" text,
        "mailConfig" text,
        "autoTradeApproval" boolean NOT NULL DEFAULT false,
        "buySpecificIbanEnabled" boolean NOT NULL DEFAULT false,
        "ownerId" integer
      )
    `);
    await dataSource.query(`CREATE TABLE "user" ("id" integer PRIMARY KEY, "walletId" integer)`);
    await dataSource.query(`
      CREATE TABLE "migration_audit_lock" (
        "migration" text PRIMARY KEY
      )
    `);
    await dataSource.query(`
      CREATE TABLE "migration_audit_event" (
        "id" serial PRIMARY KEY,
        "migration" text NOT NULL,
        "eventType" text NOT NULL,
        "applyEventId" integer UNIQUE,
        "payload" jsonb NOT NULL
      )
    `);

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('inserts the Denario wallet and the two inert Polygon assets', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    expect(await countWallet(queryRunner)).toBe(1);
    const dgc = (await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = 'Polygon/DGC'`)).at(0);
    expect(dgc).toMatchObject({
      name: 'DGC',
      type: 'Token',
      blockchain: 'Polygon',
      chainId: '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f',
      decimals: 8,
      buyable: false,
      sellable: false,
      priceRuleId: null,
    });
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    const audit = await queryRunner.query(`SELECT "payload" FROM "migration_audit_event" ORDER BY "id"`);
    const apply = audit.at(0).payload;
    expect(apply.createdWallet.id).toEqual(expect.any(Number));
    expect(apply.createdAssets.map((asset: { uniqueName: string }) => asset.uniqueName)).toEqual([
      'Polygon/DGC',
      'Polygon/DSC',
    ]);
  });

  it('is idempotent — a second up() does not duplicate rows', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);
    await new AddDenarioWalletAndAssets().up(queryRunner);

    expect(await countWallet(queryRunner)).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await queryRunner.query(`SELECT "id" FROM "migration_audit_event"`)).toHaveLength(1);
  });

  it('keeps the Denario partner name unique while the migration is active', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    await expect(
      queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`),
    ).rejects.toThrow();

    expect(await countWallet(queryRunner)).toBe(1);
  });

  it('does not make other wallet names unique', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Other', 'First')`);
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Other', 'Second')`);

    // pg-mem does not enforce this partial index the way real PostgreSQL does — its query planner
    // ignores the predicate and answers a WHERE name='Other' lookup as if the index covered every row.
    // This test only demonstrates that the migration issues no index DDL scoped to non-Denario names;
    // it is not a substitute for exercising the predicate semantics against real PostgreSQL.
    const wallets = await queryRunner.query(`SELECT "id", "name" FROM "wallet"`);
    expect(wallets.filter((wallet) => wallet.name === 'Other')).toHaveLength(2);
  });

  it('down() removes the inert assets and the unused wallet it created, but keeps the index', async () => {
    const migration = new AddDenarioWalletAndAssets();
    await migration.up(queryRunner);

    const statements: string[] = [];
    const originalQuery = queryRunner.query.bind(queryRunner);
    const querySpy = jest.spyOn(queryRunner, 'query').mockImplementation((query, parameters) => {
      statements.push(query);
      return originalQuery(query, parameters);
    });

    try {
      await migration.down(queryRunner);
    } finally {
      querySpy.mockRestore();
    }

    expect(await countWallet(queryRunner)).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
    const events = await queryRunner.query(`SELECT "payload" FROM "migration_audit_event" ORDER BY "id"`);
    expect(events.map((row) => row.payload.action)).toEqual([
      'applyDenarioWalletAndAssets',
      'rollbackDenarioWalletAndAssets',
    ]);

    // The partial unique index is declared entity schema, not data owned by this migration's rollback.
    expect(statements.some((sql) => sql.includes('DROP INDEX'))).toBe(false);
  });

  it('up() -> down() preserves pre-existing rows by exact ownership', async () => {
    const preExistingDgcId = await insertInertAsset(queryRunner, 'Polygon/DGC');
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);

    const migration = new AddDenarioWalletAndAssets();
    await migration.up(queryRunner);

    expect(await countWallet(queryRunner)).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);

    await migration.down(queryRunner);

    expect(await countWallet(queryRunner)).toBe(1);
    expect(await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Polygon/DGC'`)).toEqual([
      { id: preExistingDgcId },
    ]);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
  });

  it('fails closed and preserves every row when duplicate Denario wallet names already exist', async () => {
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);

    await expect(new AddDenarioWalletAndAssets().up(queryRunner)).rejects.toThrow('ambiguous');

    expect(await countWallet(queryRunner)).toBe(2);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
    expect(await queryRunner.query(`SELECT "id" FROM "migration_audit_event"`)).toEqual([]);
  });

  it.each([
    ['isKycClient', 'true'],
    ['autoTradeApproval', 'true'],
    ['usesDummyAddresses', 'true'],
    ['displayFraudWarning', 'true'],
    ['amlRules', "'1'"],
    ['ownerId', '7'],
  ])('fails closed when a pre-existing Denario wallet conflicts via %s', async (column, value) => {
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);
    await queryRunner.query(`UPDATE "wallet" SET "${column}" = ${value} WHERE "name" = 'Denario'`);

    await expect(new AddDenarioWalletAndAssets().up(queryRunner)).rejects.toThrow(column);

    expect(await countWallet(queryRunner)).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await queryRunner.query(`SELECT "id" FROM "migration_audit_event"`)).toEqual([]);
  });

  it('fails closed when a pre-existing Denario asset conflicts with the inert definition', async () => {
    await insertInertAsset(queryRunner, 'Polygon/DGC');
    await queryRunner.query(`UPDATE "asset" SET "decimals" = 18 WHERE "uniqueName" = 'Polygon/DGC'`);

    await expect(new AddDenarioWalletAndAssets().up(queryRunner)).rejects.toThrow('decimals');

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
  });

  it.each([
    'buyable',
    'sellable',
    'cardBuyable',
    'cardSellable',
    'instantBuyable',
    'instantSellable',
    'paymentEnabled',
    'refEnabled',
  ])('down() fails closed when an owned asset changed via %s', async (flag) => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    await queryRunner.query(`UPDATE "asset" SET "${flag}" = true WHERE "uniqueName" = 'Polygon/DSC'`);

    await expect(new AddDenarioWalletAndAssets().down(queryRunner)).rejects.toThrow('changed since creation');
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await countWallet(queryRunner)).toBe(1);
    expect(await queryRunner.query(`SELECT "id" FROM "migration_audit_event"`)).toHaveLength(1);
  });

  it('down() fails closed when an owned wallet has users attached', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    const walletId = (await queryRunner.query(`SELECT "id" FROM "wallet" WHERE "name" = 'Denario'`)).at(0).id;
    await queryRunner.query(`INSERT INTO "user" ("id", "walletId") VALUES (1, ${walletId})`);

    await expect(new AddDenarioWalletAndAssets().down(queryRunner)).rejects.toThrow('attached users');
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await countWallet(queryRunner)).toBe(1);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    const migration = new AddDenarioWalletAndAssets();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = await queryRunner.query(`SELECT "payload" FROM "migration_audit_event" ORDER BY "id"`);
    expect(events.map((row) => row.payload.action)).toEqual([
      'applyDenarioWalletAndAssets',
      'rollbackDenarioWalletAndAssets',
      'applyDenarioWalletAndAssets',
      'rollbackDenarioWalletAndAssets',
    ]);
  });

  it('keeps the Denario-only uniqueness guard after the migration is reverted', async () => {
    const migration = new AddDenarioWalletAndAssets();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);

    await expect(
      queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`),
    ).rejects.toThrow();
    expect(await countWallet(queryRunner)).toBe(1);
  });

  it('creates the uniqueness guard even when the environment is not prd', async () => {
    delete process.env.ENVIRONMENT;

    await new AddDenarioWalletAndAssets().up(queryRunner);

    expect(await countWallet(queryRunner)).toBe(0);
    await queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`);
    await expect(
      queryRunner.query(`INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario')`),
    ).rejects.toThrow();
  });
});
