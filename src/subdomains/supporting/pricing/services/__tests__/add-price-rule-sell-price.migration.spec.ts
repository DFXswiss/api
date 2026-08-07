import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

let AddPriceRuleSellPrice: new () => Migration;

describe('AddPriceRuleSellPrice migration (postgres semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddPriceRuleSellPrice = require('../../../../../../migration/1786300000000-AddPriceRuleSellPrice');
  });

  beforeEach(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

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
        "priceValiditySeconds" integer NOT NULL,
        "priceTimestamp" timestamp
      )
    `);

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function columnNames(): Promise<string[]> {
    const rows = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'price_rule'
       ORDER BY column_name`,
    );
    return rows.map((r: { column_name: string }) => r.column_name);
  }

  it('up() adds sellPriceSource and currentSellPrice; down() removes them', async () => {
    const before = await columnNames();
    expect(before).not.toContain('sellPriceSource');
    expect(before).not.toContain('currentSellPrice');

    const migration = new AddPriceRuleSellPrice();
    await migration.up(queryRunner);

    const afterUp = await columnNames();
    expect(afterUp).toContain('sellPriceSource');
    expect(afterUp).toContain('currentSellPrice');

    // Columns are nullable and unused until a later data migration writes them.
    await queryRunner.query(
      `INSERT INTO "price_rule" ("priceSource", "priceAsset", "priceReference", "priceValiditySeconds")
       VALUES ('Denario', 'DGC', 'USD', 300)`,
    );
    const row = (await queryRunner.query(`SELECT "sellPriceSource", "currentSellPrice" FROM "price_rule"`)).at(0);
    expect(row.sellPriceSource).toBeNull();
    expect(row.currentSellPrice).toBeNull();

    await migration.down(queryRunner);

    const afterDown = await columnNames();
    expect(afterDown).not.toContain('sellPriceSource');
    expect(afterDown).not.toContain('currentSellPrice');
  });
});
