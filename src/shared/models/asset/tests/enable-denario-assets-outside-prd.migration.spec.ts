import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let EnableDenarioAssetsOutsidePrd: new () => Migration;

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

describe('EnableDenarioAssetsOutsidePrd migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    EnableDenarioAssetsOutsidePrd = require('../../../../../migration/1786200000000-EnableDenarioAssetsOutsidePrd');
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
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "uniqueName" text NOT NULL,
        "buyable" boolean NOT NULL DEFAULT false,
        "sellable" boolean NOT NULL DEFAULT false,
        "cardBuyable" boolean NOT NULL DEFAULT false,
        "cardSellable" boolean NOT NULL DEFAULT false,
        "instantBuyable" boolean NOT NULL DEFAULT false,
        "instantSellable" boolean NOT NULL DEFAULT false,
        "paymentEnabled" boolean NOT NULL DEFAULT false,
        "refEnabled" boolean NOT NULL DEFAULT false,
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

    // Baseline after LinkDenarioPriceRules: assets already have a priceRuleId, still non-tradable.
    await dataSource.query(
      `INSERT INTO "asset" (
         "uniqueName", "buyable", "sellable", "cardBuyable", "cardSellable",
         "instantBuyable", "instantSellable", "paymentEnabled", "refEnabled", "priceRuleId"
       ) VALUES
         ('Polygon/DGC', false, false, false, false, false, false, false, false, 101),
         ('Polygon/DSC', false, false, false, false, false, false, false, false, 102)`,
    );

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function getAsset(uniqueName: string): Promise<{
    id: number;
    buyable: boolean;
    sellable: boolean;
    cardBuyable: boolean;
    cardSellable: boolean;
    instantBuyable: boolean;
    instantSellable: boolean;
    paymentEnabled: boolean;
    refEnabled: boolean;
    priceRuleId: number | null;
  }> {
    return (await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = '${uniqueName}'`)).at(0);
  }

  async function getAuditEvents(): Promise<Record<string, unknown>[]> {
    return queryRunner.query(`SELECT "system", "subsystem", "message" FROM "log" ORDER BY "id"`).then((rows) =>
      rows.map((row: { system: string; subsystem: string; message: string }) => ({
        system: row.system,
        subsystem: row.subsystem,
        ...JSON.parse(row.message),
      })),
    );
  }

  it('outside prd: sets buyable and sellable true, writes audit, leaves other flags false', async () => {
    await new EnableDenarioAssetsOutsidePrd().up(queryRunner);

    const dgc = await getAsset('Polygon/DGC');
    const dsc = await getAsset('Polygon/DSC');
    expect(dgc.buyable).toBe(true);
    expect(dgc.sellable).toBe(true);
    expect(dsc.buyable).toBe(true);
    expect(dsc.sellable).toBe(true);

    // priceRuleId must remain the one set by LinkDenarioPriceRules.
    expect(dgc.priceRuleId).toBe(101);
    expect(dsc.priceRuleId).toBe(102);

    for (const row of [dgc, dsc]) {
      expect(row.cardBuyable).toBe(false);
      expect(row.cardSellable).toBe(false);
      expect(row.instantBuyable).toBe(false);
      expect(row.instantSellable).toBe(false);
      expect(row.paymentEnabled).toBe(false);
      expect(row.refEnabled).toBe(false);
    }

    const audit = await getAuditEvents();
    expect(audit).toHaveLength(1);
    expect(audit.at(0)).toMatchObject({
      system: 'Migration',
      subsystem: 'EnableDenarioAssetsOutsidePrd1786200000000',
      action: 'applyEnableDenarioAssetsOutsidePrd',
    });
    expect((audit.at(0)?.assets as unknown[]).length).toBe(2);
  });

  it('does not touch non-tradability flags even when they start false (guards extending UPDATEs)', async () => {
    // Mutation catch: an UPDATE that also sets cardBuyable/instantBuyable/etc. must fail this test.
    await new EnableDenarioAssetsOutsidePrd().up(queryRunner);

    const dgc = await getAsset('Polygon/DGC');
    const dsc = await getAsset('Polygon/DSC');

    const untouched = [
      'cardBuyable',
      'cardSellable',
      'instantBuyable',
      'instantSellable',
      'paymentEnabled',
      'refEnabled',
    ] as const;

    for (const flag of untouched) {
      expect(dgc[flag]).toBe(false);
      expect(dsc[flag]).toBe(false);
    }

    // Only buyable + sellable flipped.
    expect(dgc.buyable).toBe(true);
    expect(dgc.sellable).toBe(true);
    expect(dsc.buyable).toBe(true);
    expect(dsc.sellable).toBe(true);
  });

  it('is a no-op on prd: no audit, buyable and sellable stay false', async () => {
    process.env.ENVIRONMENT = 'prd';

    await new EnableDenarioAssetsOutsidePrd().up(queryRunner);

    expect(await getAuditEvents()).toEqual([]);
    expect((await getAsset('Polygon/DGC')).buyable).toBe(false);
    expect((await getAsset('Polygon/DGC')).sellable).toBe(false);
    expect((await getAsset('Polygon/DSC')).buyable).toBe(false);
    expect((await getAsset('Polygon/DSC')).sellable).toBe(false);
  });

  it('is idempotent — a second up() does not duplicate audit events', async () => {
    await new EnableDenarioAssetsOutsidePrd().up(queryRunner);
    await new EnableDenarioAssetsOutsidePrd().up(queryRunner);

    expect(await getAuditEvents()).toHaveLength(1);
    expect((await getAsset('Polygon/DGC')).buyable).toBe(true);
    expect((await getAsset('Polygon/DGC')).sellable).toBe(true);
  });

  it('throws when an asset has no priceRuleId', async () => {
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = NULL WHERE "uniqueName" = 'Polygon/DGC'`);

    await expect(new EnableDenarioAssetsOutsidePrd().up(queryRunner)).rejects.toThrow('priceRuleId');

    expect(await getAuditEvents()).toEqual([]);
    expect((await getAsset('Polygon/DGC')).buyable).toBe(false);
    expect((await getAsset('Polygon/DSC')).buyable).toBe(false);
  });

  it.each(['Polygon/DGC', 'Polygon/DSC'] as const)('throws when %s is missing', async (missing) => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = '${missing}'`);

    await expect(new EnableDenarioAssetsOutsidePrd().up(queryRunner)).rejects.toThrow(missing);

    expect(await getAuditEvents()).toEqual([]);
    const survivor = missing === 'Polygon/DGC' ? 'Polygon/DSC' : 'Polygon/DGC';
    expect((await getAsset(survivor)).buyable).toBe(false);
    expect((await getAsset(survivor)).sellable).toBe(false);
  });

  it('down() restores previous buyable and sellable values', async () => {
    const migration = new EnableDenarioAssetsOutsidePrd();
    await migration.up(queryRunner);
    expect((await getAsset('Polygon/DGC')).buyable).toBe(true);
    expect((await getAsset('Polygon/DGC')).sellable).toBe(true);

    await migration.down(queryRunner);

    expect((await getAsset('Polygon/DGC')).buyable).toBe(false);
    expect((await getAsset('Polygon/DGC')).sellable).toBe(false);
    expect((await getAsset('Polygon/DSC')).buyable).toBe(false);
    expect((await getAsset('Polygon/DSC')).sellable).toBe(false);
    // priceRuleId untouched.
    expect((await getAsset('Polygon/DGC')).priceRuleId).toBe(101);
    expect((await getAsset('Polygon/DSC')).priceRuleId).toBe(102);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual([
      'applyEnableDenarioAssetsOutsidePrd',
      'rollbackEnableDenarioAssetsOutsidePrd',
    ]);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    const migration = new EnableDenarioAssetsOutsidePrd();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual([
      'applyEnableDenarioAssetsOutsidePrd',
      'rollbackEnableDenarioAssetsOutsidePrd',
      'applyEnableDenarioAssetsOutsidePrd',
      'rollbackEnableDenarioAssetsOutsidePrd',
    ]);
  });
});
