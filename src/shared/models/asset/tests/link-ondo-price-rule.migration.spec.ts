import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let LinkOndoPriceRule: new () => Migration;

// The migration under test is prod-gated (ENVIRONMENT === 'prd'); force it so up()/down() execute.
const originalEnvironment = process.env.ENVIRONMENT;
beforeEach(() => {
  process.env.ENVIRONMENT = 'prd';
});
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = originalEnvironment;
});

describe('LinkOndoPriceRule migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LinkOndoPriceRule = require('../../../../../migration/1785600300000-LinkOndoPriceRule');
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
        "priceRuleId" integer
      )
    `);
    await dataSource.query(`
      CREATE TABLE "price_rule" (
        "id" serial PRIMARY KEY,
        "priceSource" text NOT NULL,
        "priceAsset" text NOT NULL,
        "priceReference" text NOT NULL
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
    await dataSource.query(`INSERT INTO "asset" ("id", "uniqueName") VALUES (398, 'Ethereum/ONDO')`);
    await dataSource.query(
      `INSERT INTO "price_rule" ("id", "priceSource", "priceAsset", "priceReference")
       VALUES (60, 'CoinGecko', 'ondo-finance', 'tether')`,
    );

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function getPriceRuleId(): Promise<number | null> {
    return queryRunner
      .query(`SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'`)
      .then((rows) => rows.at(0).priceRuleId);
  }

  async function getAuditEvents(): Promise<Record<string, unknown>[]> {
    return queryRunner
      .query(`SELECT "message" FROM "log" ORDER BY "id"`)
      .then((rows) => rows.map((row) => JSON.parse(row.message)));
  }

  it('links the active ONDO asset to its semantic price rule and writes an audit event', async () => {
    await new LinkOndoPriceRule().up(queryRunner);

    expect(await getPriceRuleId()).toBe(60);
    expect(await getAuditEvents()).toEqual([
      {
        action: 'applyOndoPriceRule',
        assetId: 398,
        uniqueName: 'Ethereum/ONDO',
        previousPriceRuleId: null,
        nextPriceRuleId: 60,
      },
    ]);
  });

  it('resolves an environment-local rule id instead of assuming seed id 60', async () => {
    await queryRunner.query(`DELETE FROM "price_rule"`);
    await queryRunner.query(
      `INSERT INTO "price_rule" ("id", "priceSource", "priceAsset", "priceReference")
       VALUES (712, 'CoinGecko', 'ondo-finance', 'tether')`,
    );

    await new LinkOndoPriceRule().up(queryRunner);

    expect(await getPriceRuleId()).toBe(712);
  });

  it('is a no-op when ONDO already references the semantic rule', async () => {
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = 60 WHERE "id" = 398`);

    await new LinkOndoPriceRule().up(queryRunner);

    expect(await getPriceRuleId()).toBe(60);
    expect(await getAuditEvents()).toEqual([]);
  });

  it('fails closed when the required ONDO asset is missing', async () => {
    await queryRunner.query(`DELETE FROM "asset" WHERE "id" = 398`);

    await expect(new LinkOndoPriceRule().up(queryRunner)).rejects.toThrow('was not found');
    expect(await getAuditEvents()).toEqual([]);
  });

  it('does not assign a price rule when the apply audit insert returns no id', async () => {
    const originalQuery = queryRunner.query.bind(queryRunner);
    const querySpy = jest.spyOn(queryRunner, 'query').mockImplementation((query, parameters) => {
      // INSERT succeeds from the driver's point of view but yields no RETURNING row — the
      // fail-closed id check must abort before priceRuleId is written.
      if (typeof query === 'string' && query.startsWith('INSERT INTO "log"')) {
        return Promise.resolve([]);
      }
      return originalQuery(query, parameters);
    });

    try {
      await expect(new LinkOndoPriceRule().up(queryRunner)).rejects.toThrow(/Failed to write audit event/);
      expect(await getPriceRuleId()).toBeNull();
    } finally {
      querySpy.mockRestore();
    }
  });

  it('fails closed on a missing, ambiguous, or conflicting price rule', async () => {
    await queryRunner.query(`DELETE FROM "price_rule"`);
    await expect(new LinkOndoPriceRule().up(queryRunner)).rejects.toThrow('exactly one ONDO price rule');

    await queryRunner.query(
      `INSERT INTO "price_rule" ("id", "priceSource", "priceAsset", "priceReference") VALUES
       (60, 'CoinGecko', 'ondo-finance', 'tether'),
       (61, 'CoinGecko', 'ondo-finance', 'tether')`,
    );
    await expect(new LinkOndoPriceRule().up(queryRunner)).rejects.toThrow('found 2');

    await queryRunner.query(`DELETE FROM "price_rule" WHERE "id" = 61`);
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = 999 WHERE "id" = 398`);
    await expect(new LinkOndoPriceRule().up(queryRunner)).rejects.toThrow('refusing overwrite');

    expect(await getPriceRuleId()).toBe(999);
    expect(await getAuditEvents()).toEqual([]);
  });

  it('reverts only the price-rule assignment it owns and retains both audit events', async () => {
    const migration = new LinkOndoPriceRule();
    await migration.up(queryRunner);

    await migration.down(queryRunner);

    expect(await getPriceRuleId()).toBeNull();
    expect((await getAuditEvents()).map((event) => event.action)).toEqual([
      'applyOndoPriceRule',
      'rollbackOndoPriceRule',
    ]);
    expect((await getAuditEvents()).at(1)).toMatchObject({
      previousPriceRuleId: 60,
      nextPriceRuleId: null,
      outcome: 'reverted',
    });
  });

  it('preserves a later re-point and records the skipped rollback', async () => {
    const migration = new LinkOndoPriceRule();
    await migration.up(queryRunner);
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = 999 WHERE "id" = 398`);

    await migration.down(queryRunner);

    expect(await getPriceRuleId()).toBe(999);
    expect((await getAuditEvents()).at(1)).toMatchObject({
      previousPriceRuleId: 999,
      nextPriceRuleId: 999,
      outcome: 'skippedPriceRuleChanged',
    });
  });

  it('never mutates another asset that reused the audited ONDO id', async () => {
    const migration = new LinkOndoPriceRule();
    await migration.up(queryRunner);
    await queryRunner.query(`DELETE FROM "asset" WHERE "id" = 398`);
    await queryRunner.query(
      `INSERT INTO "asset" ("id", "uniqueName", "priceRuleId") VALUES (398, 'Ethereum/OTHER', 60)`,
    );

    await migration.down(queryRunner);

    const other = (await queryRunner.query(`SELECT "priceRuleId" FROM "asset" WHERE "id" = 398`)).at(0);
    expect(other.priceRuleId).toBe(60);
    expect((await getAuditEvents()).at(1)).toMatchObject({
      currentUniqueName: 'Ethereum/OTHER',
      expectedUniqueName: 'Ethereum/ONDO',
      outcome: 'skippedAssetIdentityChanged',
      previousPriceRuleId: 60,
      nextPriceRuleId: 60,
    });
  });

  it('supports two apply/rollback cycles with four distinct events', async () => {
    const migration = new LinkOndoPriceRule();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect((await getAuditEvents()).map((event) => event.action)).toEqual([
      'applyOndoPriceRule',
      'rollbackOndoPriceRule',
      'applyOndoPriceRule',
      'rollbackOndoPriceRule',
    ]);
  });

  it('fails closed on a foreign or corrupt migration log payload and leaves the asset unchanged', async () => {
    await queryRunner.query(`UPDATE "asset" SET "priceRuleId" = 60 WHERE "id" = 398`);

    await queryRunner.query(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
       VALUES (NOW(), NOW(), 'Migration', 'LinkOndoPriceRule1785600300000', 'Info', $1)`,
      [
        JSON.stringify({
          action: 'forgedRollback',
          applyLogId: 1,
          assetId: 398,
          uniqueName: 'Ethereum/ONDO',
        }),
      ],
    );

    await expect(new LinkOndoPriceRule().down(queryRunner)).rejects.toThrow('Invalid audit action');
    expect(await getPriceRuleId()).toBe(60);

    await queryRunner.query(`DELETE FROM "log"`);
    await queryRunner.query(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
       VALUES (NOW(), NOW(), 'Migration', 'LinkOndoPriceRule1785600300000', 'Info', 'not-json')`,
    );

    await expect(new LinkOndoPriceRule().down(queryRunner)).rejects.toThrow('Corrupt audit event');
    expect(await getPriceRuleId()).toBe(60);
  });
});
