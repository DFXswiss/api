import { DataSource, getMetadataArgsStorage, QueryRunner } from 'typeorm';
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

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const removed = await getTrackingColumns();
    await queryRunner.commitTransaction();

    expect(removed).toEqual([]);
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
});
