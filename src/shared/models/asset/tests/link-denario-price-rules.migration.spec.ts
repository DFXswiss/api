import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let LinkDenarioPriceRules: new () => Migration;

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

describe('LinkDenarioPriceRules migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LinkDenarioPriceRules = require('../../../../../migration/1786100000000-LinkDenarioPriceRules');
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
        "priceRuleId" integer
      )
    `);
    await dataSource.query(`
      CREATE TABLE "price_rule" (
        "id" serial PRIMARY KEY,
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "created" timestamp NOT NULL DEFAULT NOW(),
        "priceSource" text NOT NULL,
        "priceAsset" text NOT NULL,
        "priceReference" text NOT NULL,
        "currentPrice" double precision,
        "priceValiditySeconds" integer NOT NULL,
        "priceTimestamp" timestamp,
        "referenceId" integer
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

    // Baseline: USDT reference + inert Denario assets as left by AddDenarioAssetsOutsidePrd.
    await dataSource.query(`INSERT INTO "asset" ("uniqueName", "buyable") VALUES ('Ethereum/USDT', false)`);
    await dataSource.query(
      `INSERT INTO "asset" ("uniqueName", "buyable", "sellable")
       VALUES
         ('Polygon/DGC', false, false),
         ('Polygon/DSC', false, false)`,
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
    priceRuleId: number | null;
  }> {
    return (await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = '${uniqueName}'`)).at(0);
  }

  async function getPriceRules(): Promise<
    {
      id: number;
      priceSource: string;
      priceAsset: string;
      priceReference: string;
      priceValiditySeconds: number;
      referenceId: number;
      currentPrice: number | null;
      priceTimestamp: Date | null;
    }[]
  > {
    return queryRunner.query(`SELECT * FROM "price_rule" ORDER BY "id"`);
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

  async function assertLinked(): Promise<void> {
    const rules = await getPriceRules();
    expect(rules).toHaveLength(2);

    const dgcRule = rules.find((r) => r.priceAsset === 'DGC');
    const dscRule = rules.find((r) => r.priceAsset === 'DSC');
    expect(dgcRule).toMatchObject({
      priceSource: 'Denario',
      priceReference: 'USD',
      priceValiditySeconds: 300,
      currentPrice: null,
      priceTimestamp: null,
    });
    expect(dscRule).toMatchObject({
      priceSource: 'Denario',
      priceReference: 'USD',
      priceValiditySeconds: 300,
      currentPrice: null,
      priceTimestamp: null,
    });

    const usdt = await getAsset('Ethereum/USDT');
    expect(dgcRule?.referenceId).toBe(usdt.id);
    expect(dscRule?.referenceId).toBe(usdt.id);

    const dgc = await getAsset('Polygon/DGC');
    const dsc = await getAsset('Polygon/DSC');
    expect(dgc.priceRuleId).toBe(dgcRule?.id);
    expect(dsc.priceRuleId).toBe(dscRule?.id);

    // Does not touch tradability flags.
    expect(dgc.buyable).toBe(false);
    expect(dgc.sellable).toBe(false);
    expect(dsc.buyable).toBe(false);
    expect(dsc.sellable).toBe(false);
  }

  it('outside prd: creates Denario rules, links both assets, writes audit', async () => {
    await new LinkDenarioPriceRules().up(queryRunner);

    await assertLinked();

    const audit = await getAuditEvents();
    expect(audit).toHaveLength(1);
    expect(audit.at(0)).toMatchObject({
      system: 'Migration',
      subsystem: 'LinkDenarioPriceRules1786100000000',
      action: 'applyLinkDenarioPriceRules',
    });
    expect((audit.at(0)?.assets as unknown[]).length).toBe(2);
    expect((audit.at(0)?.createdPriceRules as unknown[]).length).toBe(2);
  });

  it('is a no-op on prd: no rules, no link, no audit', async () => {
    process.env.ENVIRONMENT = 'prd';

    await new LinkDenarioPriceRules().up(queryRunner);

    expect(await getPriceRules()).toEqual([]);
    expect(await getAuditEvents()).toEqual([]);
    expect((await getAsset('Polygon/DGC')).priceRuleId).toBeNull();
    expect((await getAsset('Polygon/DSC')).priceRuleId).toBeNull();
  });

  it('down() is a no-op on prd', async () => {
    // Apply outside prd, then flip ENVIRONMENT so down() must refuse to touch the rows.
    const migration = new LinkDenarioPriceRules();
    await migration.up(queryRunner);
    expect(await getPriceRules()).toHaveLength(2);

    process.env.ENVIRONMENT = 'prd';
    await migration.down(queryRunner);

    expect(await getPriceRules()).toHaveLength(2);
    expect((await getAsset('Polygon/DGC')).priceRuleId).not.toBeNull();
    expect((await getAsset('Polygon/DSC')).priceRuleId).not.toBeNull();
    // Only the apply event — no rollback audit on prd.
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it('is idempotent — a second up() does not duplicate rules or audit events', async () => {
    await new LinkDenarioPriceRules().up(queryRunner);
    await new LinkDenarioPriceRules().up(queryRunner);

    expect(await getPriceRules()).toHaveLength(2);
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it('throws and changes nothing when Ethereum/USDT is missing', async () => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Ethereum/USDT'`);

    await expect(new LinkDenarioPriceRules().up(queryRunner)).rejects.toThrow('Ethereum/USDT');

    expect(await getPriceRules()).toEqual([]);
    expect(await getAuditEvents()).toEqual([]);
    expect((await getAsset('Polygon/DGC')).priceRuleId).toBeNull();
    expect((await getAsset('Polygon/DSC')).priceRuleId).toBeNull();
  });

  it.each(['Polygon/DGC', 'Polygon/DSC'] as const)('throws and changes nothing when %s is missing', async (missing) => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = '${missing}'`);

    await expect(new LinkDenarioPriceRules().up(queryRunner)).rejects.toThrow(missing);

    expect(await getPriceRules()).toEqual([]);
    expect(await getAuditEvents()).toEqual([]);
    const survivor = missing === 'Polygon/DGC' ? 'Polygon/DSC' : 'Polygon/DGC';
    expect((await getAsset(survivor)).priceRuleId).toBeNull();
  });

  it('throws and does not overwrite when an asset already has a foreign priceRuleId', async () => {
    const foreign = (
      await queryRunner.query(
        `INSERT INTO "price_rule" ("priceSource", "priceAsset", "priceReference", "priceValiditySeconds")
         VALUES ('CoinGecko', 'foreign', 'tether', 300) RETURNING "id"`,
      )
    ).at(0).id;
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = ${foreign} WHERE "uniqueName" = 'Polygon/DGC'`);

    await expect(new LinkDenarioPriceRules().up(queryRunner)).rejects.toThrow('refusing overwrite');

    expect(await getAuditEvents()).toEqual([]);
    expect((await getAsset('Polygon/DGC')).priceRuleId).toBe(foreign);
    expect((await getAsset('Polygon/DSC')).priceRuleId).toBeNull();
    const rules = await getPriceRules();
    expect(rules).toHaveLength(1);
    expect(rules.at(0)?.priceSource).toBe('CoinGecko');
  });

  it('down() unlinks assets and deletes owned rules', async () => {
    const migration = new LinkDenarioPriceRules();
    await migration.up(queryRunner);
    expect(await getPriceRules()).toHaveLength(2);

    await migration.down(queryRunner);

    expect((await getAsset('Polygon/DGC')).priceRuleId).toBeNull();
    expect((await getAsset('Polygon/DSC')).priceRuleId).toBeNull();
    expect(await getPriceRules()).toEqual([]);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual(['applyLinkDenarioPriceRules', 'rollbackLinkDenarioPriceRules']);
  });

  it('down() throws and deletes nothing when an owned price_rule was changed', async () => {
    const migration = new LinkDenarioPriceRules();
    await migration.up(queryRunner);

    await queryRunner.query(
      `UPDATE "price_rule" SET "priceSource" = 'Constant:0.999:Denario' WHERE "priceAsset" = 'DSC'`,
    );

    await expect(migration.down(queryRunner)).rejects.toThrow('changed since creation');

    expect(await getPriceRules()).toHaveLength(2);
    expect((await getAsset('Polygon/DGC')).priceRuleId).not.toBeNull();
    expect((await getAsset('Polygon/DSC')).priceRuleId).not.toBeNull();
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    const migration = new LinkDenarioPriceRules();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual([
      'applyLinkDenarioPriceRules',
      'rollbackLinkDenarioPriceRules',
      'applyLinkDenarioPriceRules',
      'rollbackLinkDenarioPriceRules',
    ]);
    expect(await getPriceRules()).toEqual([]);
  });
});
