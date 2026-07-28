import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'unstoppable_wallet_app_spec';

const EXPECTED_BLOCKCHAINS =
  'Ethereum;BinanceSmartChain;Polygon;Arbitrum;Optimism;Base;Bitcoin;Solana;Tron;Zano;Monero';
const EXPECTED_DEEP_LINK = 'unstoppable.money:';
const WALLET_NAME = 'Unstoppable Wallet';

let AddUnstoppableWalletApp: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddUnstoppableWalletApp migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddUnstoppableWalletApp = require('../../../../../migration/1785400000000-AddUnstoppableWalletApp');
  });

  it('inserts all eleven methods in order and omits hasActionDeepLink/recommended/semiCompatible/assets', async () => {
    const migration = new AddUnstoppableWalletApp();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "wallet_app"') && s.includes(`'unstoppable wallet'`) && !s.includes('insert')) {
          return [];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(2);

    const insertSql = calls.find(([statement]) => statement.toLowerCase().includes('insert'))?.[0] ?? '';
    expect(insertSql).toContain(EXPECTED_BLOCKCHAINS);
    expect(insertSql).toContain(EXPECTED_DEEP_LINK);
    expect(insertSql).toContain(`'${WALLET_NAME}'`);

    // Columns intentionally left at DB default / NULL — must not appear in the INSERT column list.
    expect(insertSql.toLowerCase()).not.toContain('hasactiondeeplink');
    expect(insertSql.toLowerCase()).not.toContain('recommended');
    expect(insertSql.toLowerCase()).not.toContain('semicompatible');
    expect(insertSql.toLowerCase()).not.toContain('"assets"');
  });

  it('is idempotent: only SELECT runs when Unstoppable Wallet already exists', async () => {
    const migration = new AddUnstoppableWalletApp();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "wallet_app"') && s.includes(`'unstoppable wallet'`) && !s.includes('insert')) {
          return [{ id: 42 }];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0].toLowerCase()).toContain('select');
    expect(calls.some(([statement]) => statement.toLowerCase().includes('insert'))).toBe(false);
  });

  it('down() deletes only by name + deepLink + blockchains (ownership guard)', async () => {
    const migration = new AddUnstoppableWalletApp();
    const queryRunner = {
      query: jest.fn(async (_sql: string) => []),
    };

    await migration.down(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    const deleteSql = calls[0][0];
    expect(deleteSql.toLowerCase()).toContain('delete');
    expect(deleteSql).toContain(`'${WALLET_NAME}'`);
    expect(deleteSql).toContain(EXPECTED_DEEP_LINK);
    expect(deleteSql).toContain(EXPECTED_BLOCKCHAINS);
  });
});

describeDb('AddUnstoppableWalletApp migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddUnstoppableWalletApp = require('../../../../../migration/1785400000000-AddUnstoppableWalletApp');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // Minimal fixture matching wallet-app.entity.ts / initial schema columns the migration
    // touches. UNIQUE(name) is required: the idempotency guard exists to protect against it.
    await queryRunner.query(`
      CREATE TABLE "wallet_app" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(256) NOT NULL,
        "websiteUrl" character varying(256),
        "iconUrl" character varying(256) NOT NULL,
        "deepLink" character varying(256),
        "hasActionDeepLink" boolean,
        "appStoreUrl" text,
        "playStoreUrl" text,
        "recommended" boolean,
        "blockchains" text,
        "assets" character varying(256),
        "semiCompatible" boolean,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_wallet_app_name_spec" UNIQUE ("name")
      )
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

  it('up() creates the row with exact blockchains and deepLink', async () => {
    const migration = new AddUnstoppableWalletApp();
    await migration.up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "name", "websiteUrl", "iconUrl", "deepLink", "appStoreUrl", "playStoreUrl",
              "blockchains", "active", "hasActionDeepLink", "recommended", "semiCompatible", "assets"
       FROM "wallet_app" WHERE "name" = '${WALLET_NAME}'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: WALLET_NAME,
      websiteUrl: 'https://unstoppable.money/',
      iconUrl: 'https://dfx.swiss/images/app/UnstoppableWallet.webp',
      deepLink: EXPECTED_DEEP_LINK,
      appStoreUrl: 'https://apps.apple.com/app/unstoppable-crypto-wallet/id1447619907',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=io.horizontalsystems.bankwallet',
      blockchains: EXPECTED_BLOCKCHAINS,
      active: true,
    });
    expect(rows[0].hasActionDeepLink).toBeNull();
    expect(rows[0].recommended).toBeNull();
    expect(rows[0].semiCompatible).toBeNull();
    expect(rows[0].assets).toBeNull();
  });

  it('is idempotent: re-running up() does not create a second row', async () => {
    const migration = new AddUnstoppableWalletApp();
    await migration.up(queryRunner);
    await expect(migration.up(queryRunner)).resolves.not.toThrow();

    const count = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "wallet_app" WHERE "name" = '${WALLET_NAME}'`)
    )[0].c;

    expect(count).toBe(1);
  });

  it('down() does not delete a pre-existing foreign Unstoppable Wallet row (ownership)', async () => {
    // Hand-created row with the same name but different characteristic values — not ours.
    await queryRunner.query(`
      INSERT INTO "wallet_app" ("name", "iconUrl", "deepLink", "blockchains", "active")
      VALUES ('${WALLET_NAME}', 'https://example.com/foreign.webp', 'foreign-scheme:', 'Bitcoin', true)
    `);

    const before = await queryRunner.query(
      `SELECT "name", "iconUrl", "deepLink", "blockchains", "active" FROM "wallet_app" WHERE "name" = '${WALLET_NAME}'`,
    );
    expect(before).toHaveLength(1);

    const migration = new AddUnstoppableWalletApp();
    // up() sees the name and skips; down() must not wipe the foreign row.
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const after = await queryRunner.query(
      `SELECT "name", "iconUrl", "deepLink", "blockchains", "active" FROM "wallet_app" WHERE "name" = '${WALLET_NAME}'`,
    );

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      name: WALLET_NAME,
      iconUrl: 'https://example.com/foreign.webp',
      deepLink: 'foreign-scheme:',
      blockchains: 'Bitcoin',
      active: true,
    });
  });

  it('up() then down() on an empty table removes the row this migration created', async () => {
    const migration = new AddUnstoppableWalletApp();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const count = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "wallet_app" WHERE "name" = '${WALLET_NAME}'`)
    )[0].c;

    expect(count).toBe(0);
  });
});
