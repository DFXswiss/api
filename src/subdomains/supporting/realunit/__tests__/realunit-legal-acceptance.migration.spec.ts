import { createMigrationDataSource, destroyMigrationDataSource } from 'src/shared/utils/migration-test.util';
import { DataSource, QueryRunner } from 'typeorm';

// This suite runs the real grandfathering backfill against a throwaway Postgres. It is skipped unless a
// connection string is provided (so CI, which has no DB, stays green); the disposable-DB dry-run sets it.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// Its own database. `user`, `user_data` and `aktionariat_registration` are built by the backfill spec
// too, and Jest schedules the two files on parallel workers against the same server — sharing one
// database means each beforeEach drops the other's tables mid-test.
const DATABASE = 'mig_realunit_legal_acceptance';

// The migration is plain CommonJS (module.exports = class ...); required lazily inside beforeAll so a
// skipped run (CI, no DB) never pulls the .js through the TS transform.
let AddRealUnitLegalAcceptance: new () => { up(qr: QueryRunner): Promise<void>; down(qr: QueryRunner): Promise<void> };

// The six RealUnitLegalAgreement enum VALUES that must be seeded per grandfathered account.
const AGREEMENTS = [
  'ResidenceConfirmation',
  'TaxDomicileSelfCertification',
  'RealUnitPrivacyPolicy',
  'RealUnitRegistrationAgreement',
  'AktionariatTermsOfService',
  'DfxTermsAndConditions',
];

describeDb('AddRealUnitLegalAcceptance migration (real Postgres grandfathering)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddRealUnitLegalAcceptance = require('../../../../../migration/1783900000000-AddRealUnitLegalAcceptance');
    dataSource = await createMigrationDataSource(DATABASE);
  });

  afterAll(async () => {
    await destroyMigrationDataSource(dataSource, DATABASE);
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // minimal prerequisite schema (only the columns the backfill reads + the FK target user_data)
    await qr.query(`DROP TABLE IF EXISTS "real_unit_legal_acceptance" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "aktionariat_registration" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "user" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "user_data" CASCADE`);
    await qr.query(`CREATE TABLE "user_data" ("id" integer PRIMARY KEY)`);
    await qr.query(`CREATE TABLE "user" ("id" integer PRIMARY KEY, "userDataId" integer)`);
    await qr.query(
      `CREATE TABLE "aktionariat_registration" ("id" SERIAL PRIMARY KEY, "status" character varying(256) NOT NULL, "userId" integer NOT NULL)`,
    );

    // accounts
    await qr.query(`INSERT INTO "user_data" ("id") VALUES (1),(2),(3),(4)`);
    // wallets: account 3 owns TWO wallets (12, 13) -> the multi-wallet dedup case
    await qr.query(`INSERT INTO "user" ("id","userDataId") VALUES (10,1),(11,2),(12,3),(13,3),(14,4)`);
    // registrations: acc1 Completed; acc2 ManualReview (not registered); acc3 two Completed wallets; acc4 Failed
    await qr.query(
      `INSERT INTO "aktionariat_registration" ("id","status","userId") VALUES (100,'Completed',10),(101,'ManualReview',11),(102,'Completed',12),(103,'Completed',13),(104,'Failed',14)`,
    );
  });

  afterEach(async () => {
    await qr.release();
  });

  const runUp = (): Promise<void> => new AddRealUnitLegalAcceptance().up(qr);
  const runDown = (): Promise<void> => new AddRealUnitLegalAcceptance().down(qr);
  const rows = (sql: string, params: any[] = []): Promise<any[]> => qr.query(sql, params);
  const count = async (sql: string, params: any[] = []): Promise<number> =>
    Number((await qr.query(sql, params))[0].count);

  it('grandfathers exactly the COMPLETED accounts with all six agreements at the current version', async () => {
    await runUp();

    // acc1 (6) + acc3 (6, deduped across its two Completed wallets) = 12; acc2 (ManualReview) and acc4 (Failed) excluded
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance"`)).toBe(12);
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance" WHERE "userDataId" = 1`)).toBe(6);
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance" WHERE "userDataId" = 2`)).toBe(0);
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance" WHERE "userDataId" = 3`)).toBe(6);
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance" WHERE "userDataId" = 4`)).toBe(0);

    // every grandfathered row carries the current version and each account gets each agreement exactly once
    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance" WHERE "version" <> '20260712'`)).toBe(0);
    const acc1Agreements = (
      await rows(`SELECT "agreement" FROM "real_unit_legal_acceptance" WHERE "userDataId" = 1`)
    ).map((r) => r.agreement);
    expect(acc1Agreements).toHaveLength(6);
    expect(new Set(acc1Agreements)).toEqual(new Set(AGREEMENTS));
  });

  it('is idempotent: re-running the grandfathering insert never duplicates or violates the unique index', async () => {
    await runUp();

    // Re-execute the backfill INSERT (mirrors the migration's guarded insert): the NOT EXISTS anti-join must
    // make this a no-op against the unique (userDataId, agreement, version) index instead of throwing.
    await qr.query(`
      INSERT INTO "real_unit_legal_acceptance" ("userDataId", "agreement", "version", "acceptedDate", "created", "updated")
      SELECT registered."userDataId", agreement."name", '20260712', TIMESTAMP '2026-07-12 00:00:00', now(), now()
      FROM (
        SELECT DISTINCT u."userDataId"
        FROM "aktionariat_registration" ar
        JOIN "user" u ON u.id = ar."userId"
        WHERE ar."status" = 'Completed' AND u."userDataId" IS NOT NULL
      ) registered
      CROSS JOIN (VALUES
        ('ResidenceConfirmation'),('TaxDomicileSelfCertification'),('RealUnitPrivacyPolicy'),
        ('RealUnitRegistrationAgreement'),('AktionariatTermsOfService'),('DfxTermsAndConditions')
      ) AS agreement("name")
      WHERE NOT EXISTS (
        SELECT 1 FROM "real_unit_legal_acceptance" existing
        WHERE existing."userDataId" = registered."userDataId"
          AND existing."agreement" = agreement."name"
          AND existing."version" = '20260712'
      )
    `);

    expect(await count(`SELECT count(*) FROM "real_unit_legal_acceptance"`)).toBe(12);
  });

  it('down() drops the table cleanly', async () => {
    await runUp();
    await runDown();

    const exists = await count(
      `SELECT count(*) FROM information_schema.tables WHERE table_name = 'real_unit_legal_acceptance' AND table_schema = 'public'`,
    );
    expect(exists).toBe(0);
  });
});
