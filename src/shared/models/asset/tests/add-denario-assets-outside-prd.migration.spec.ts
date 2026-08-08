import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let AddDenarioAssetsOutsidePrd: new () => Migration;

const EXPECTED_DGC = {
  name: 'DGC',
  uniqueName: 'Polygon/DGC',
  type: 'Token',
  blockchain: 'Polygon',
  category: 'Public',
  dexName: 'DGC',
  chainId: '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f',
  decimals: 8,
  description: 'Denario Gold Coin',
  buyable: false,
  sellable: false,
  cardBuyable: false,
  cardSellable: false,
  instantBuyable: false,
  instantSellable: false,
  paymentEnabled: false,
  refEnabled: false,
  refundEnabled: true,
  ikna: false,
  personalIbanEnabled: false,
  comingSoon: false,
  priceRuleId: null,
} as const;

const EXPECTED_DSC = {
  name: 'DSC',
  uniqueName: 'Polygon/DSC',
  type: 'Token',
  blockchain: 'Polygon',
  category: 'Public',
  dexName: 'DSC',
  chainId: '0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7',
  decimals: 8,
  description: 'Denario Silver Coin',
  buyable: false,
  sellable: false,
  cardBuyable: false,
  cardSellable: false,
  instantBuyable: false,
  instantSellable: false,
  paymentEnabled: false,
  refEnabled: false,
  refundEnabled: true,
  ikna: false,
  personalIbanEnabled: false,
  comingSoon: false,
  priceRuleId: null,
} as const;

async function countAsset(queryRunner: QueryRunner, uniqueName: string): Promise<number> {
  const rows = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "asset" WHERE "uniqueName" = '${uniqueName}'`);
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

// This migration is non-prd-gated (ENVIRONMENT === 'prd' is a no-op); force a non-prd value so
// up()/down() execute unless a test overrides ENVIRONMENT.
const originalEnvironment = process.env.ENVIRONMENT;
beforeEach(() => {
  process.env.ENVIRONMENT = 'dev';
});
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = originalEnvironment;
});

describe('AddDenarioAssetsOutsidePrd migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioAssetsOutsidePrd = require('../../../../../migration/1786000000000-AddDenarioAssetsOutsidePrd');
  });

  beforeEach(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
    db.public.registerFunction({
      name: 'pg_advisory_xact_lock',
      args: [DataType.bigint],
      returns: DataType.null,
      implementation: () => null,
    });

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
      CREATE TABLE "log" (
        "id" serial PRIMARY KEY,
        "created" timestamp NOT NULL DEFAULT NOW(),
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "system" text NOT NULL,
        "subsystem" text NOT NULL,
        "severity" text NOT NULL,
        "message" text NOT NULL
      )
    `);

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('inserts both inert Polygon Denario assets with the exact expected columns outside prd', async () => {
    await new AddDenarioAssetsOutsidePrd().up(queryRunner);

    const dgc = (await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = 'Polygon/DGC'`)).at(0);
    const dsc = (await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = 'Polygon/DSC'`)).at(0);

    expect(dgc).toMatchObject(EXPECTED_DGC);
    expect(dsc).toMatchObject(EXPECTED_DSC);

    // isActive-relevant flags must all be false so Asset.isActive stays false.
    for (const row of [dgc, dsc]) {
      expect(row.buyable).toBe(false);
      expect(row.sellable).toBe(false);
      expect(row.cardBuyable).toBe(false);
      expect(row.cardSellable).toBe(false);
      expect(row.instantBuyable).toBe(false);
      expect(row.instantSellable).toBe(false);
      expect(row.paymentEnabled).toBe(false);
      expect(row.refEnabled).toBe(false);
      expect(row.priceRuleId).toBeNull();
    }

    const audit = await queryRunner.query(`SELECT "system", "subsystem", "message" FROM "log" ORDER BY "id"`);
    expect(audit).toHaveLength(1);
    expect(audit.at(0)).toMatchObject({ system: 'Migration', subsystem: 'AddDenarioAssetsOutsidePrd1786000000000' });
    const apply = JSON.parse(audit.at(0).message);
    expect(apply.action).toBe('applyDenarioAssetsOutsidePrd');
    expect(apply.createdAssets.map((asset: { uniqueName: string }) => asset.uniqueName)).toEqual([
      'Polygon/DGC',
      'Polygon/DSC',
    ]);
  });

  it('is a no-op on prd and writes no audit event', async () => {
    process.env.ENVIRONMENT = 'prd';

    await new AddDenarioAssetsOutsidePrd().up(queryRunner);

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
    expect(await queryRunner.query(`SELECT "id" FROM "log"`)).toEqual([]);
  });

  it('is idempotent — a second up() does not duplicate rows or audit events', async () => {
    await new AddDenarioAssetsOutsidePrd().up(queryRunner);
    await new AddDenarioAssetsOutsidePrd().up(queryRunner);

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await queryRunner.query(`SELECT "id" FROM "log"`)).toHaveLength(1);
  });

  it.each([
    ['buyable', true],
    ['chainId', '0xdeadbeef'],
  ] as const)('fails closed when a pre-existing asset conflicts via %s and changes nothing', async (column, value) => {
    await insertInertAsset(queryRunner, 'Polygon/DGC');
    if (typeof value === 'boolean') {
      await queryRunner.query(`UPDATE "asset" SET "${column}" = ${value} WHERE "uniqueName" = 'Polygon/DGC'`);
    } else {
      await queryRunner.query(`UPDATE "asset" SET "${column}" = '${value}' WHERE "uniqueName" = 'Polygon/DGC'`);
    }

    await expect(new AddDenarioAssetsOutsidePrd().up(queryRunner)).rejects.toThrow(column);

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
    expect(await queryRunner.query(`SELECT "id" FROM "log"`)).toEqual([]);
  });

  it('down() removes only the assets this migration created', async () => {
    const migration = new AddDenarioAssetsOutsidePrd();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(0);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(0);
    const events = await queryRunner.query(`SELECT "message" FROM "log" ORDER BY "id"`);
    expect(events.map((row) => JSON.parse(row.message).action)).toEqual([
      'applyDenarioAssetsOutsidePrd',
      'rollbackDenarioAssetsOutsidePrd',
    ]);
  });

  it('up() -> down() preserves pre-existing matching rows by exact ownership', async () => {
    const preExistingDgcId = await insertInertAsset(queryRunner, 'Polygon/DGC');

    const migration = new AddDenarioAssetsOutsidePrd();
    await migration.up(queryRunner);

    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);

    await migration.down(queryRunner);

    expect(await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Polygon/DGC'`)).toEqual([
      { id: preExistingDgcId },
    ]);
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
    await new AddDenarioAssetsOutsidePrd().up(queryRunner);

    await queryRunner.query(`UPDATE "asset" SET "${flag}" = true WHERE "uniqueName" = 'Polygon/DSC'`);

    await expect(new AddDenarioAssetsOutsidePrd().down(queryRunner)).rejects.toThrow('changed since creation');
    expect(await countAsset(queryRunner, 'Polygon/DGC')).toBe(1);
    expect(await countAsset(queryRunner, 'Polygon/DSC')).toBe(1);
    expect(await queryRunner.query(`SELECT "id" FROM "log"`)).toHaveLength(1);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    const migration = new AddDenarioAssetsOutsidePrd();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = await queryRunner.query(`SELECT "message" FROM "log" ORDER BY "id"`);
    expect(events.map((row) => JSON.parse(row.message).action)).toEqual([
      'applyDenarioAssetsOutsidePrd',
      'rollbackDenarioAssetsOutsidePrd',
      'applyDenarioAssetsOutsidePrd',
      'rollbackDenarioAssetsOutsidePrd',
    ]);
  });
});
