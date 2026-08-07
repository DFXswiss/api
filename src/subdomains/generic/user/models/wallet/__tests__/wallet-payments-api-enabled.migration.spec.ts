import { DataSource, QueryRunner } from 'typeorm';

/**
 * Unit assertions on the migration SQL (always run) plus an optional real-Postgres
 * up → down → up cycle when MIGRATION_TEST_PG is set.
 *
 * Isolated per schema, like 17 of the migration specs here, rather than per database via
 * createMigrationDataSource, which 2 use: that helper exists for the asymmetric index DDL
 * TypeORM emits, and this migration creates no index.
 */
describe('AddWalletPaymentsApiEnabled migration', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Migration = require('../../../../../../../migration/1786122400000-AddWalletPaymentsApiEnabled');

  it('adds the column fail-closed and backfills address or delivering payment webhook config', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().up(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]: [string]) => statement).join('\n');
    expect(sql).toContain('ALTER TABLE "wallet" ADD "paymentsApiEnabled" boolean NOT NULL DEFAULT false');
    expect(sql).toContain('UPDATE "wallet" SET "paymentsApiEnabled" = true');
    expect(sql).toContain('"address" IS NOT NULL');
    expect(sql).toContain('"apiUrl" IS NOT NULL');
    expect(sql).toContain('"webhookConfig" IS JSON');
    expect(sql).toContain("'True','ConsentOnly','WalletOnly'");
    // Rollback restore after backfill: close-only (ops disables), never opens access.
    expect(sql).toContain("'PaymentsApiEnabledRollback'");
    expect(sql).toContain('jsonb_array_elements');
    expect(sql).toMatch(/"message" IS JSON/);
    // Field-type guards before cast (jsonb_typeof + CASE) so wrong types skip the element
    // without aborting — PG does not short-circuit AND around casts.
    expect(sql).toContain(`jsonb_typeof(e."elem" -> 'id') = 'number'`);
    expect(sql).toContain(`jsonb_typeof(e."elem" -> 'paymentsApiEnabled') = 'boolean'`);
    expect(sql).toContain(`(e."elem"->>'paymentsApiEnabled')::boolean`);
    expect(sql).toMatch(/END\s*=\s*false/);
    expect(sql).toContain('SET "paymentsApiEnabled" = false');
    // No partner ID list — backfill is semantic.
    expect(sql).not.toMatch(/WHERE\s+"id"\s+IN/i);
    // isKycClient is the wrong predicate (see migration header).
    expect(sql).not.toContain('WHERE "isKycClient" = true');
    // apiUrl alone is not enough (must not reintroduce the old broad OR).
    expect(sql).not.toMatch(/SET "paymentsApiEnabled" = true WHERE "address" IS NOT NULL OR "apiUrl" IS NOT NULL\s*$/m);
  });

  it('audits current flag values into log before dropping the column on rollback', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().down(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [auditSql] = queryRunner.query.mock.calls[0] as [string];
    const [dropSql] = queryRunner.query.mock.calls[1] as [string];

    expect(auditSql).toContain('INSERT INTO "log"');
    expect(auditSql).toContain("'Wallet'");
    expect(auditSql).toContain("'PaymentsApiEnabledRollback'");
    expect(auditSql).toContain('"paymentsApiEnabled"');
    expect(auditSql).toContain('json_agg');
    // Audit write is ordered before the DROP (fail-closed in the migration transaction).
    expect(dropSql).toBe('ALTER TABLE "wallet" DROP COLUMN "paymentsApiEnabled"');
  });
});

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'wallet_payments_api_enabled_spec';

let AddWalletPaymentsApiEnabled: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describeDb('AddWalletPaymentsApiEnabled migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddWalletPaymentsApiEnabled = require('../../../../../../../migration/1786122400000-AddWalletPaymentsApiEnabled');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);
    await queryRunner.query(`
      CREATE TABLE "wallet" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying(256),
        "address" character varying(256),
        "apiUrl" character varying(256),
        "webhookConfig" text,
        "isKycClient" boolean NOT NULL DEFAULT false
      )
    `);
    // Minimal "log" table matching the columns the migration INSERT uses.
    await queryRunner.query(`
      CREATE TABLE "log" (
        "id" SERIAL PRIMARY KEY,
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "system" character varying(256) NOT NULL,
        "subsystem" character varying(256) NOT NULL,
        "severity" character varying(256) NOT NULL,
        "message" text NOT NULL
      )
    `);
    // Fixtures: address (pull), delivering vs non-delivering push config, invalid JSON, neither.
    await queryRunner.query(`
      INSERT INTO "wallet" ("name", "address", "apiUrl", "webhookConfig", "isKycClient") VALUES
      ('AddressKyc', '0xAAA', NULL, NULL, true),
      ('AddressNonKyc', '0xBBB', NULL, NULL, false),
      ('NoAddressKyc', NULL, NULL, NULL, true),
      ('NoAddressNonKyc', NULL, NULL, NULL, false),
      ('ApiUrlPaymentTrue', NULL, 'https://partner.example.com/hook', '{"payment":"True","kyc":"True"}', false),
      ('ApiUrlPaymentFalse', NULL, 'https://partner.example.com/hook', '{"payment":"False","kyc":"True"}', false),
      ('ApiUrlWebhookNull', NULL, 'https://partner.example.com/hook', NULL, false),
      ('ApiUrlInvalidJson', NULL, 'https://partner.example.com/hook', 'not-json{', false),
      ('Neither', NULL, NULL, NULL, false)
    `);
    // Pre-existing log rows: down() must only append its own audit; foreign rows and older
    // same-key rows must survive. Older PaymentsApiEnabledRollback is valid JSON but stale
    // (empty snapshot — would not restore AddressNonKyc=false). Content is no-op on a first
    // up() where this row is still the newest; after down() appends the real audit, a later
    // up() must take that newest row (proven by AddressNonKyc remaining false).
    await queryRunner.query(`
      INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message") VALUES
      (now() - interval '2 hours', now() - interval '2 hours', 'UnrelatedSystem', 'UnrelatedSubsystem', 'Info',
       'foreign-preexisting-log-row'),
      (now() - interval '1 hour', now() - interval '1 hour', 'Wallet', 'PaymentsApiEnabledRollback', 'Info',
       '[]')
    `);
  });

  afterEach(async () => {
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('up → down → up: backfills current access only; rollback audit restores ops flips', async () => {
    const migration = new AddWalletPaymentsApiEnabled();

    // Snapshot pre-up state: down() must restore this (other columns + row count).
    const beforeUp: {
      id: number;
      name: string;
      address: string | null;
      apiUrl: string | null;
      isKycClient: boolean;
    }[] = await queryRunner.query(
      `SELECT "id", "name", "address", "apiUrl", "isKycClient" FROM "wallet" ORDER BY "id"`,
    );
    const [{ count: beforeCount }] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "wallet"`);

    await migration.up(queryRunner);

    let rows: { name: string; paymentsApiEnabled: boolean }[] = await queryRunner.query(
      `SELECT "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      { name: 'AddressKyc', paymentsApiEnabled: true },
      { name: 'AddressNonKyc', paymentsApiEnabled: true },
      { name: 'NoAddressKyc', paymentsApiEnabled: false },
      { name: 'NoAddressNonKyc', paymentsApiEnabled: false },
      { name: 'ApiUrlPaymentTrue', paymentsApiEnabled: true },
      { name: 'ApiUrlPaymentFalse', paymentsApiEnabled: false },
      { name: 'ApiUrlWebhookNull', paymentsApiEnabled: false },
      { name: 'ApiUrlInvalidJson', paymentsApiEnabled: false },
      { name: 'Neither', paymentsApiEnabled: false },
    ]);

    // Ops decision that diverges from the backfill: flip AddressNonKyc (backfill true) to false.
    // The audit on down() must retain this manual value — and a later up() must restore it.
    await queryRunner.query(`UPDATE "wallet" SET "paymentsApiEnabled" = false WHERE "name" = 'AddressNonKyc'`);
    const flagsBeforeDown: { id: number; name: string; paymentsApiEnabled: boolean }[] = await queryRunner.query(
      `SELECT "id", "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`,
    );
    expect(flagsBeforeDown.find((r) => r.name === 'AddressNonKyc')?.paymentsApiEnabled).toBe(false);

    await migration.down(queryRunner);

    const columnsAfterDown: { column_name: string }[] = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${SCHEMA}' AND table_name = 'wallet' AND column_name = 'paymentsApiEnabled'`,
    );
    expect(columnsAfterDown).toEqual([]);

    // Ownership of down(): only the column is gone; remaining columns and row count match pre-up.
    const afterDown: {
      id: number;
      name: string;
      address: string | null;
      apiUrl: string | null;
      isKycClient: boolean;
    }[] = await queryRunner.query(
      `SELECT "id", "name", "address", "apiUrl", "isKycClient" FROM "wallet" ORDER BY "id"`,
    );
    const [{ count: afterDownCount }] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "wallet"`);
    expect(afterDown).toEqual(beforeUp);
    expect(afterDownCount).toBe(beforeCount);

    // Ownership of down() on "log": only appends; foreign pre-existing row is unchanged.
    const foreignLogs: { system: string; subsystem: string; severity: string; message: string }[] =
      await queryRunner.query(
        `SELECT "system", "subsystem", "severity", "message" FROM "log"
         WHERE "system" = 'UnrelatedSystem' AND "subsystem" = 'UnrelatedSubsystem'`,
      );
    expect(foreignLogs).toEqual([
      {
        system: 'UnrelatedSystem',
        subsystem: 'UnrelatedSubsystem',
        severity: 'Info',
        message: 'foreign-preexisting-log-row',
      },
    ]);
    // Older same system/subsystem audit left untouched (down only inserts, never updates).
    const olderRollback: { message: string }[] = await queryRunner.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'Wallet' AND "subsystem" = 'PaymentsApiEnabledRollback'
       ORDER BY "id" ASC
       LIMIT 1`,
    );
    expect(olderRollback[0].message).toBe('[]');

    // Newest matching audit: pre-drop flag values including the manual flip
    // (AddressNonKyc = false, not the backfill true). Not length-locked so a prior
    // rollback row in the same DB does not break the assertion.
    const auditLogs: { system: string; subsystem: string; severity: string; message: string }[] =
      await queryRunner.query(
        `SELECT "system", "subsystem", "severity", "message" FROM "log"
         WHERE "system" = 'Wallet' AND "subsystem" = 'PaymentsApiEnabledRollback'
         ORDER BY "id" DESC`,
      );
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    const newestAudit = auditLogs[0];
    expect(newestAudit.severity).toBe('Info');
    const audited = JSON.parse(newestAudit.message) as { id: number; paymentsApiEnabled: boolean }[];
    expect(audited).toEqual(flagsBeforeDown.map((r) => ({ id: r.id, paymentsApiEnabled: r.paymentsApiEnabled })));
    const manualEntry = audited.find((e) => e.id === flagsBeforeDown.find((r) => r.name === 'AddressNonKyc')?.id);
    expect(manualEntry?.paymentsApiEnabled).toBe(false);
    // Sanity: a still-true backfill wallet is also recorded.
    const stillEnabled = audited.find((e) => e.id === flagsBeforeDown.find((r) => r.name === 'AddressKyc')?.id);
    expect(stillEnabled?.paymentsApiEnabled).toBe(true);

    // up again: backfill re-derives, then rollback audit restores AddressNonKyc = false.
    await migration.up(queryRunner);
    rows = await queryRunner.query(`SELECT "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`);
    expect(rows).toEqual([
      { name: 'AddressKyc', paymentsApiEnabled: true },
      { name: 'AddressNonKyc', paymentsApiEnabled: false },
      { name: 'NoAddressKyc', paymentsApiEnabled: false },
      { name: 'NoAddressNonKyc', paymentsApiEnabled: false },
      { name: 'ApiUrlPaymentTrue', paymentsApiEnabled: true },
      { name: 'ApiUrlPaymentFalse', paymentsApiEnabled: false },
      { name: 'ApiUrlWebhookNull', paymentsApiEnabled: false },
      { name: 'ApiUrlInvalidJson', paymentsApiEnabled: false },
      { name: 'Neither', paymentsApiEnabled: false },
    ]);

    // New row after migration gets fail-closed default (no address, no apiUrl → stays false).
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "address", "apiUrl", "webhookConfig", "isKycClient")
       VALUES ('NewWallet', NULL, NULL, NULL, false)`,
    );
    const [fresh] = await queryRunner.query(`SELECT "paymentsApiEnabled" FROM "wallet" WHERE "name" = 'NewWallet'`);
    expect(fresh.paymentsApiEnabled).toBe(false);

    // New row with address after migration: DEFAULT false still applies on INSERT
    // (backfill only runs once in up()); a newly set address does not auto-enable.
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "address", "apiUrl", "webhookConfig", "isKycClient")
       VALUES ('NewWithAddress', '0xCCC', NULL, NULL, false)`,
    );
    const [freshWithAddress] = await queryRunner.query(
      `SELECT "paymentsApiEnabled" FROM "wallet" WHERE "name" = 'NewWithAddress'`,
    );
    expect(freshWithAddress.paymentsApiEnabled).toBe(false);

    rows = await queryRunner.query(`SELECT "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`);
    expect(rows).toEqual([
      { name: 'AddressKyc', paymentsApiEnabled: true },
      { name: 'AddressNonKyc', paymentsApiEnabled: false },
      { name: 'NoAddressKyc', paymentsApiEnabled: false },
      { name: 'NoAddressNonKyc', paymentsApiEnabled: false },
      { name: 'ApiUrlPaymentTrue', paymentsApiEnabled: true },
      { name: 'ApiUrlPaymentFalse', paymentsApiEnabled: false },
      { name: 'ApiUrlWebhookNull', paymentsApiEnabled: false },
      { name: 'ApiUrlInvalidJson', paymentsApiEnabled: false },
      { name: 'Neither', paymentsApiEnabled: false },
      { name: 'NewWallet', paymentsApiEnabled: false },
      { name: 'NewWithAddress', paymentsApiEnabled: false },
    ]);
  });

  it('invalid webhookConfig JSON does not abort up() and does not enable the wallet', async () => {
    const migration = new AddWalletPaymentsApiEnabled();
    await expect(migration.up(queryRunner)).resolves.not.toThrow();
    const [row] = await queryRunner.query(
      `SELECT "paymentsApiEnabled" FROM "wallet" WHERE "name" = 'ApiUrlInvalidJson'`,
    );
    expect(row.paymentsApiEnabled).toBe(false);
  });

  it('restore ignores true claims in rollback log (close-only; never opens access)', async () => {
    const migration = new AddWalletPaymentsApiEnabled();

    // Wallet that stays false after semantic backfill (payment:"False").
    const [{ id: targetId }] = await queryRunner.query(`SELECT "id" FROM "wallet" WHERE "name" = 'ApiUrlPaymentFalse'`);

    // Hostile / stale audit: claims this wallet should be enabled.
    await queryRunner.query(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
       VALUES (now(), now(), 'Wallet', 'PaymentsApiEnabledRollback', 'Info',
         $1)`,
      [JSON.stringify([{ id: targetId, paymentsApiEnabled: true }])],
    );

    await migration.up(queryRunner);

    const [row] = await queryRunner.query(
      `SELECT "paymentsApiEnabled" FROM "wallet" WHERE "name" = 'ApiUrlPaymentFalse'`,
    );
    expect(row.paymentsApiEnabled).toBe(false);
  });

  it('restore skips non-JSON rollback message without aborting up()', async () => {
    const migration = new AddWalletPaymentsApiEnabled();

    await queryRunner.query(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
       VALUES (now(), now(), 'Wallet', 'PaymentsApiEnabledRollback', 'Info', 'not json')`,
    );

    await expect(migration.up(queryRunner)).resolves.not.toThrow();

    // Backfill still applied as if no audit existed.
    const rows: { name: string; paymentsApiEnabled: boolean }[] = await queryRunner.query(
      `SELECT "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      { name: 'AddressKyc', paymentsApiEnabled: true },
      { name: 'AddressNonKyc', paymentsApiEnabled: true },
      { name: 'NoAddressKyc', paymentsApiEnabled: false },
      { name: 'NoAddressNonKyc', paymentsApiEnabled: false },
      { name: 'ApiUrlPaymentTrue', paymentsApiEnabled: true },
      { name: 'ApiUrlPaymentFalse', paymentsApiEnabled: false },
      { name: 'ApiUrlWebhookNull', paymentsApiEnabled: false },
      { name: 'ApiUrlInvalidJson', paymentsApiEnabled: false },
      { name: 'Neither', paymentsApiEnabled: false },
    ]);
  });

  it('restore skips wrong field types without aborting; valid false sibling still applies', async () => {
    const migration = new AddWalletPaymentsApiEnabled();

    // Two wallets that semantic backfill enables (address present).
    const [{ id: badTypeId }] = await queryRunner.query(`SELECT "id" FROM "wallet" WHERE "name" = 'AddressKyc'`);
    const [{ id: validDisableId }] = await queryRunner.query(
      `SELECT "id" FROM "wallet" WHERE "name" = 'AddressNonKyc'`,
    );

    // Same audit record: string id, string paymentsApiEnabled, and one valid close-only entry.
    // Without jsonb_typeof guards the casts would abort SQL_MIGRATE.
    await queryRunner.query(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
       VALUES (now(), now(), 'Wallet', 'PaymentsApiEnabledRollback', 'Info', $1)`,
      [
        JSON.stringify([
          { id: 'abc', paymentsApiEnabled: false },
          { id: badTypeId, paymentsApiEnabled: 'nope' },
          { id: validDisableId, paymentsApiEnabled: false },
        ]),
      ],
    );

    await expect(migration.up(queryRunner)).resolves.not.toThrow();

    const rows: { name: string; paymentsApiEnabled: boolean }[] = await queryRunner.query(
      `SELECT "name", "paymentsApiEnabled" FROM "wallet" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      // Wrong-type elements skipped → backfill true retained.
      { name: 'AddressKyc', paymentsApiEnabled: true },
      // Valid false sibling applied.
      { name: 'AddressNonKyc', paymentsApiEnabled: false },
      { name: 'NoAddressKyc', paymentsApiEnabled: false },
      { name: 'NoAddressNonKyc', paymentsApiEnabled: false },
      { name: 'ApiUrlPaymentTrue', paymentsApiEnabled: true },
      { name: 'ApiUrlPaymentFalse', paymentsApiEnabled: false },
      { name: 'ApiUrlWebhookNull', paymentsApiEnabled: false },
      { name: 'ApiUrlInvalidJson', paymentsApiEnabled: false },
      { name: 'Neither', paymentsApiEnabled: false },
    ]);
  });
});
