import { DataSource, getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as IbanTools from 'ibantools';
import { FiatOutput } from '../fiat-output.entity';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'bank_frick_tracking_spec';

let AddBankFrickPayoutTracking: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('FiatOutput Bank Frick column metadata', () => {
  it('keeps every tracking column aligned with the migration length', () => {
    const trackingProperties = ['frickOrderId', 'frickTxId', 'frickOrderStatus', 'frickError'];
    const trackingColumns = Object.fromEntries(
      getMetadataArgsStorage()
        .columns.filter((column) => column.target === FiatOutput && trackingProperties.includes(column.propertyName))
        .map((column) => [column.propertyName, { length: column.options.length, nullable: column.options.nullable }]),
    );

    expect(trackingColumns).toEqual({
      frickOrderId: { length: 256, nullable: true },
      frickTxId: { length: 256, nullable: true },
      frickOrderStatus: { length: 256, nullable: true },
      frickError: { length: 256, nullable: true },
    });
  });
});

describe('Bank Frick registry rollout data', () => {
  it('ships exactly two checksum-valid, clearly synthetic local seed accounts', () => {
    const csv = readFileSync(join(__dirname, '../../../../../migration/seed/bank.csv'), 'utf8');
    const frickRows = csv
      .split('\n')
      .filter((line) => line.includes(',Bank Frick,'))
      .map((line) => line.split(','));

    expect(frickRows).toHaveLength(2);
    expect(frickRows.map((row) => row[6]).sort()).toEqual(['CHF', 'EUR']);
    for (const row of frickRows) {
      expect(row[4]).toContain('FRICK');
      expect(IbanTools.validateIBAN(row[4]).valid).toBe(true);
      expect(row.slice(7, 11)).toEqual(['FALSE', 'FALSE', 'FALSE', 'TRUE']);
    }
  });

  it('installs disabled production placeholders and both default-off process switches', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Migration = require('../../../../../migration/1783944000000-AddBankFrickPayoutTracking');
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().up(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain("'LI4200000FRICKCHF0001'");
    expect(sql).toContain("'LI5600000FRICKEUR0001'");
    expect(sql).toContain('FALSE, FALSE, FALSE, TRUE');
    expect(sql).toContain('FiatOutputFrickTransmission');
    expect(sql).toContain('FiatOutputFrickStatusCheck');
  });
});

describeDb('AddBankFrickPayoutTracking migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddBankFrickPayoutTracking = require('../../../../../migration/1783944000000-AddBankFrickPayoutTracking');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);
    await queryRunner.query(`CREATE TABLE "fiat_output" ("id" SERIAL PRIMARY KEY)`);
    await queryRunner.query(`
      CREATE TABLE "bank" (
        "id" SERIAL PRIMARY KEY,
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "created" timestamp NOT NULL DEFAULT NOW(),
        "name" varchar(256) NOT NULL,
        "iban" varchar(256) NOT NULL,
        "bic" varchar(256) NOT NULL,
        "currency" varchar(256) NOT NULL,
        "receive" boolean NOT NULL DEFAULT TRUE,
        "send" boolean NOT NULL DEFAULT TRUE,
        "sctInst" boolean NOT NULL DEFAULT FALSE,
        "amlEnabled" boolean NOT NULL DEFAULT TRUE,
        UNIQUE ("iban", "bic")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "setting" (
        "id" SERIAL PRIMARY KEY,
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "created" timestamp NOT NULL DEFAULT NOW(),
        "key" varchar(256) UNIQUE NOT NULL,
        "value" text NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "bank" ("name", "iban", "bic", "currency")
      VALUES ('Existing Bank', 'SYNTHETIC-EXISTING-ACCOUNT', 'SYNTHETICBIC', 'CHF')
    `);
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value")
      VALUES ('disabledProcess', '["ExistingProcess","FiatOutputFrickTransmission"]')
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

  it('adds nullable tracking columns at the entity length and removes them on rollback', async () => {
    const migration = new AddBankFrickPayoutTracking();

    await queryRunner.startTransaction();
    await migration.up(queryRunner);
    const added = await getTrackingColumns();
    const frickBanks = await getFrickBanks();
    const disabledProcesses = await getDisabledProcesses();
    await queryRunner.commitTransaction();

    expect(added).toEqual([
      { column_name: 'frickError', data_type: 'character varying', character_maximum_length: 256, is_nullable: 'YES' },
      {
        column_name: 'frickOrderId',
        data_type: 'character varying',
        character_maximum_length: 256,
        is_nullable: 'YES',
      },
      {
        column_name: 'frickOrderStatus',
        data_type: 'character varying',
        character_maximum_length: 256,
        is_nullable: 'YES',
      },
      { column_name: 'frickTxId', data_type: 'character varying', character_maximum_length: 256, is_nullable: 'YES' },
    ]);
    expect(frickBanks).toEqual([
      { currency: 'CHF', iban: 'LI4200000FRICKCHF0001', receive: false, send: false },
      { currency: 'EUR', iban: 'LI5600000FRICKEUR0001', receive: false, send: false },
    ]);
    expect(disabledProcesses).toEqual(['ExistingProcess', 'FiatOutputFrickTransmission', 'FiatOutputFrickStatusCheck']);

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const removed = await getTrackingColumns();
    const rolledBackFrickBanks = await getFrickBanks();
    const rolledBackDisabledProcesses = await getDisabledProcesses();
    await queryRunner.commitTransaction();

    expect(removed).toEqual([]);
    expect(rolledBackFrickBanks).toEqual([]);
    expect(rolledBackDisabledProcesses).toEqual(['ExistingProcess']);
  });

  function getTrackingColumns(): Promise<
    { column_name: string; data_type: string; character_maximum_length: number; is_nullable: string }[]
  > {
    return queryRunner.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'fiat_output'
         AND column_name IN ('frickOrderId', 'frickTxId', 'frickOrderStatus', 'frickError')
       ORDER BY column_name`,
      [SCHEMA],
    );
  }

  function getFrickBanks(): Promise<{ currency: string; iban: string; receive: boolean; send: boolean }[]> {
    return queryRunner.query(
      `SELECT "currency", "iban", "receive", "send"
       FROM "bank"
       WHERE "name" = 'Bank Frick'
       ORDER BY "currency"`,
    );
  }

  async function getDisabledProcesses(): Promise<string[]> {
    const [{ value }] = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'disabledProcess'`);
    return JSON.parse(value);
  }
});
