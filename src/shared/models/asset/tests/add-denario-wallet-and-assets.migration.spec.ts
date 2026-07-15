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

describe('AddDenarioWalletAndAssets migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioWalletAndAssets = require('../../../../../migration/1784038000000-AddDenarioWalletAndAssets');
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
        "name" text,
        "displayName" text,
        "ownerId" integer
      )
    `);
    await dataSource.query(`CREATE TABLE "user" ("id" integer PRIMARY KEY, "walletId" integer)`);

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
  });

  it('is idempotent — a second up() does not duplicate rows', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);
    await new AddDenarioWalletAndAssets().up(queryRunner);

    expect(await countWallet(queryRunner)).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
  });

  it('down() removes the inert assets and the unused wallet it created', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    await new AddDenarioWalletAndAssets().down(queryRunner);

    expect(await countWallet(queryRunner)).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
  });

  it('down() preserves assets that were activated and a wallet that has users attached', async () => {
    await new AddDenarioWalletAndAssets().up(queryRunner);

    // DGC gets a price rule, DSC is made buyable (i.e. later activated for trading)
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = 1 WHERE "uniqueName" = 'Polygon/DGC'`);
    await queryRunner.query(`UPDATE "asset" SET "buyable" = true WHERE "uniqueName" = 'Polygon/DSC'`);
    // a user is linked to the Denario wallet
    const walletId = (await queryRunner.query(`SELECT "id" FROM "wallet" WHERE "name" = 'Denario'`)).at(0).id;
    await queryRunner.query(`INSERT INTO "user" ("id", "walletId") VALUES (1, ${walletId})`);

    await new AddDenarioWalletAndAssets().down(queryRunner);

    // nothing that gained real state is destroyed (roll-forward)
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await countWallet(queryRunner)).toBe(1);
  });
});
