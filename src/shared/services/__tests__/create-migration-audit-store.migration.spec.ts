import { DataSource, QueryRunner } from 'typeorm';

// Real Postgres only: this migration creates plpgsql functions and statement-level triggers.
// pg-mem cannot execute those, so the suite is gated on MIGRATION_TEST_PG (wired in PR CI).
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'create_migration_audit_store_spec';

let CreateMigrationAuditStore: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

describeDb('CreateMigrationAuditStore migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CreateMigrationAuditStore = require('../../../../migration/1785600000000-CreateMigrationAuditStore');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);
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

  async function runUp(): Promise<void> {
    await new CreateMigrationAuditStore().up(queryRunner);
  }

  async function insertApply(migration: string, payload = '{}'): Promise<string> {
    const rows = await queryRunner.query(
      `INSERT INTO "migration_audit_event" ("migration", "eventType", "payload")
       VALUES ($1, 'Apply', $2::jsonb)
       RETURNING "id"::text AS id`,
      [migration, payload],
    );
    return rows[0].id;
  }

  it('creates both tables and a second up() is a no-op (IF NOT EXISTS / CREATE OR REPLACE)', async () => {
    await runUp();

    const tables = await queryRunner.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_name IN ('migration_audit_lock', 'migration_audit_event')
       ORDER BY table_name`,
      [SCHEMA],
    );
    expect(tables.map((row: { table_name: string }) => row.table_name)).toEqual([
      'migration_audit_event',
      'migration_audit_lock',
    ]);

    await expect(runUp()).resolves.toBeUndefined();
  });

  it('rejects UPDATE on migration_audit_event (append-only)', async () => {
    await runUp();
    await insertApply('MigA');

    await expect(queryRunner.query(`UPDATE "migration_audit_event" SET "payload" = '{}'::jsonb`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects DELETE on migration_audit_event (append-only)', async () => {
    await runUp();
    await insertApply('MigA');

    // ON DELETE RESTRICT on the self-FK is unreachable: TR_migration_audit_event_immutable
    // fires BEFORE DELETE and always rejects first.
    await expect(queryRunner.query(`DELETE FROM "migration_audit_event"`)).rejects.toThrow(/append-only/);
  });

  it('rejects TRUNCATE on migration_audit_event (append-only)', async () => {
    await runUp();
    await insertApply('MigA');

    await expect(queryRunner.query(`TRUNCATE "migration_audit_event"`)).rejects.toThrow(/append-only/);
  });

  it('rejects UPDATE, DELETE and TRUNCATE on migration_audit_lock (append-only)', async () => {
    await runUp();
    await queryRunner.query(`INSERT INTO "migration_audit_lock" ("migration") VALUES ('MigA')`);

    await expect(queryRunner.query(`UPDATE "migration_audit_lock" SET "created" = NOW()`)).rejects.toThrow(
      /append-only/,
    );
    await expect(queryRunner.query(`DELETE FROM "migration_audit_lock"`)).rejects.toThrow(/append-only/);
    await expect(queryRunner.query(`TRUNCATE "migration_audit_lock"`)).rejects.toThrow(/append-only/);
  });

  it('rejects Apply with applyEventId set (CHK_91534bc9ba42dc6285cca9321d)', async () => {
    // The validate-insert trigger only inspects Rollback rows, so this Apply path still hits the CHECK.
    await runUp();
    const applyId = await insertApply('MigA');

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
         VALUES ('MigA', 'Apply', $1, '{}'::jsonb)`,
        [applyId],
      ),
    ).rejects.toThrow(/CHK_91534bc9ba42dc6285cca9321d/);
  });

  it('rejects Rollback without applyEventId (validate insert trigger masks CHK_91534bc9ba42dc6285cca9321d)', async () => {
    // BEFORE INSERT runs before CHECK: the trigger's EXISTS fails first (null applyEventId), so
    // CHK_91534bc9ba42dc6285cca9321d is never reached for this case.
    await runUp();

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "payload")
         VALUES ('MigA', 'Rollback', '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/rollback must reference an apply event from the same migration/);
  });

  it('rejects non-object payload JSON (CHK_0aeb94fc20a8b5f808f46561c4)', async () => {
    await runUp();

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "payload")
         VALUES ('MigA', 'Apply', '[]'::jsonb)`,
      ),
    ).rejects.toThrow(/CHK_0aeb94fc20a8b5f808f46561c4/);

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "payload")
         VALUES ('MigA', 'Apply', '"x"'::jsonb)`,
      ),
    ).rejects.toThrow(/CHK_0aeb94fc20a8b5f808f46561c4/);
  });

  it('rejects a second Rollback for the same applyEventId (UQ_330ac82627cb0622555863f8240)', async () => {
    await runUp();
    const applyId = await insertApply('MigA');

    await queryRunner.query(
      `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
       VALUES ('MigA', 'Rollback', $1, '{}'::jsonb)`,
      [applyId],
    );

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
         VALUES ('MigA', 'Rollback', $1, '{}'::jsonb)`,
        [applyId],
      ),
    ).rejects.toThrow(/UQ_330ac82627cb0622555863f8240/);
  });

  it('rejects Rollback whose applyEventId exists under a different migration (validate insert trigger)', async () => {
    // The composite FK FK_4f1f02a761b4e4fe442b7b653f6 is structurally unreachable: BEFORE INSERT
    // requires an Apply under the same migration first, and whenever that EXISTS holds the
    // (id, migration) pair already satisfies the FK — same class as ON DELETE RESTRICT above.
    await runUp();
    const foreignApplyId = await insertApply('OtherMigration');

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
         VALUES ('MigA', 'Rollback', $1, '{}'::jsonb)`,
        [foreignApplyId],
      ),
    ).rejects.toThrow(/rollback must reference an apply event from the same migration/);
  });

  it('rejects Rollback that points at a Rollback of the same migration (validate insert trigger)', async () => {
    // Protection: TR_migration_audit_event_validate_insert / validateMigrationAuditEventInsert —
    // the composite FK is satisfied (id+migration exist), but the target is not eventType = 'Apply'.
    await runUp();
    const applyId = await insertApply('MigA');
    const rollbackRows = await queryRunner.query(
      `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
       VALUES ('MigA', 'Rollback', $1, '{}'::jsonb)
       RETURNING "id"::text AS id`,
      [applyId],
    );
    const rollbackId = rollbackRows[0].id;

    await expect(
      queryRunner.query(
        `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
         VALUES ('MigA', 'Rollback', $1, '{}'::jsonb)`,
        [rollbackId],
      ),
    ).rejects.toThrow(/rollback must reference an apply event from the same migration/);
  });
});
