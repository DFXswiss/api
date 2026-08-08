import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let SetDenarioSellPriceSource: new () => Migration;

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

describe('SetDenarioSellPriceSource migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SetDenarioSellPriceSource = require('../../../../../../migration/1786400000000-SetDenarioSellPriceSource');
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
      CREATE TABLE "price_rule" (
        "id" serial PRIMARY KEY,
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "created" timestamp NOT NULL DEFAULT NOW(),
        "priceSource" text NOT NULL,
        "priceAsset" text NOT NULL,
        "priceReference" text NOT NULL,
        "currentPrice" double precision,
        "sellPriceSource" text,
        "currentSellPrice" double precision,
        "priceValiditySeconds" integer NOT NULL,
        "priceTimestamp" timestamp
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

    // Baseline: Denario rules as left by LinkDenarioPriceRules (no sellPriceSource yet).
    await dataSource.query(
      `INSERT INTO "price_rule" ("priceSource", "priceAsset", "priceReference", "priceValiditySeconds")
       VALUES
         ('Denario', 'DGC', 'USD', 300),
         ('Denario', 'DSC', 'USD', 300)`,
    );

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function getRules(): Promise<
    { id: number; priceAsset: string; priceSource: string; sellPriceSource: string | null }[]
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

  async function assertSellSourcesSet(): Promise<void> {
    const rules = await getRules();
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.priceSource).toBe('Denario');
      expect(rule.sellPriceSource).toBe('Denario:bid');
    }
    expect(rules.map((r) => r.priceAsset).sort()).toEqual(['DGC', 'DSC']);
  }

  it('outside prd: sets sellPriceSource on both Denario rules and writes audit', async () => {
    await new SetDenarioSellPriceSource().up(queryRunner);

    await assertSellSourcesSet();

    const audit = await getAuditEvents();
    expect(audit).toHaveLength(1);
    expect(audit.at(0)).toMatchObject({
      system: 'Migration',
      subsystem: 'SetDenarioSellPriceSource1786400000000',
      action: 'applySetDenarioSellPriceSource',
    });
    expect((audit.at(0)?.rules as unknown[]).length).toBe(2);
  });

  it('is a no-op on prd: no column change, no audit', async () => {
    process.env.ENVIRONMENT = 'prd';

    await new SetDenarioSellPriceSource().up(queryRunner);

    const rules = await getRules();
    expect(rules.every((r) => r.sellPriceSource == null)).toBe(true);
    expect(await getAuditEvents()).toEqual([]);
  });

  it('down() is a no-op on prd', async () => {
    const migration = new SetDenarioSellPriceSource();
    await migration.up(queryRunner);
    await assertSellSourcesSet();

    process.env.ENVIRONMENT = 'prd';
    await migration.down(queryRunner);

    await assertSellSourcesSet();
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it('is idempotent — a second up() does not re-write or add audit events', async () => {
    await new SetDenarioSellPriceSource().up(queryRunner);
    await new SetDenarioSellPriceSource().up(queryRunner);

    await assertSellSourcesSet();
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it.each(['DGC', 'DSC'] as const)('throws and changes nothing when the %s rule is missing', async (missing) => {
    await queryRunner.query(`DELETE FROM "price_rule" WHERE "priceAsset" = '${missing}'`);

    await expect(new SetDenarioSellPriceSource().up(queryRunner)).rejects.toThrow(missing);

    expect(await getAuditEvents()).toEqual([]);
    const survivor = (await getRules()).at(0);
    expect(survivor?.sellPriceSource).toBeNull();
  });

  it('throws and changes nothing when a rule already has a foreign sellPriceSource', async () => {
    await queryRunner.query(`UPDATE "price_rule" SET "sellPriceSource" = 'Kraken:bid' WHERE "priceAsset" = 'DGC'`);

    await expect(new SetDenarioSellPriceSource().up(queryRunner)).rejects.toThrow('refusing overwrite');

    expect(await getAuditEvents()).toEqual([]);
    const rules = await getRules();
    expect(rules.find((r) => r.priceAsset === 'DGC')?.sellPriceSource).toBe('Kraken:bid');
    expect(rules.find((r) => r.priceAsset === 'DSC')?.sellPriceSource).toBeNull();
  });

  it('down() restores previous sellPriceSource (null)', async () => {
    const migration = new SetDenarioSellPriceSource();
    await migration.up(queryRunner);
    await assertSellSourcesSet();

    await migration.down(queryRunner);

    const rules = await getRules();
    expect(rules.every((r) => r.sellPriceSource == null)).toBe(true);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual([
      'applySetDenarioSellPriceSource',
      'rollbackSetDenarioSellPriceSource',
    ]);
  });

  it('down() throws and changes nothing when sellPriceSource was altered after apply', async () => {
    const migration = new SetDenarioSellPriceSource();
    await migration.up(queryRunner);

    await queryRunner.query(`UPDATE "price_rule" SET "sellPriceSource" = 'Denario:mid' WHERE "priceAsset" = 'DSC'`);

    await expect(migration.down(queryRunner)).rejects.toThrow('changed since apply');

    const rules = await getRules();
    expect(rules.find((r) => r.priceAsset === 'DGC')?.sellPriceSource).toBe('Denario:bid');
    expect(rules.find((r) => r.priceAsset === 'DSC')?.sellPriceSource).toBe('Denario:mid');
    expect(await getAuditEvents()).toHaveLength(1);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    const migration = new SetDenarioSellPriceSource();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = await getAuditEvents();
    expect(events.map((e) => e.action)).toEqual([
      'applySetDenarioSellPriceSource',
      'rollbackSetDenarioSellPriceSource',
      'applySetDenarioSellPriceSource',
      'rollbackSetDenarioSellPriceSource',
    ]);
    const rules = await getRules();
    expect(rules.every((r) => r.sellPriceSource == null)).toBe(true);
  });
});
