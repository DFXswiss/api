/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates "migration_audit_lock" and "migration_audit_event": an append-only record of which migration
 * inserted or mutated which row, so a later rollback can prove exactly what it owns before deleting or
 * reverting it. The tables deliberately have no TypeORM entity or API surface: operational logs are
 * observable and mutable, whereas migration ownership must not be writable through runtime endpoints.
 * Inserts into "migration_audit_event" are validated and the rows are immutable and append-only,
 * enforced by triggers, not application code.
 *
 * The tables survive down(). Removing them would destroy the exact evidence required by older migration
 * rollbacks and would recreate the audit-loss defect this store exists to prevent.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class CreateMigrationAuditStore1784994000000 {
  name = 'CreateMigrationAuditStore1784994000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "migration_audit_lock" (
        "migration" character varying(256) NOT NULL,
        "created" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_77ecea30e5135dde115ab5aa8f9" PRIMARY KEY ("migration")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "migration_audit_event" (
        "id" BIGSERIAL NOT NULL,
        "created" timestamp NOT NULL DEFAULT NOW(),
        "migration" character varying(256) NOT NULL,
        "eventType" character varying(16) NOT NULL,
        "applyEventId" bigint,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_38dbb698fe7f285a122e714a2e2" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_b2ddb93ddceb82a4fe952d7270f" UNIQUE ("id", "migration"),
        CONSTRAINT "UQ_330ac82627cb0622555863f8240" UNIQUE ("applyEventId"),
        CONSTRAINT "CHK_91534bc9ba42dc6285cca9321d" CHECK (
          ("eventType" = 'Apply' AND "applyEventId" IS NULL)
          OR ("eventType" = 'Rollback' AND "applyEventId" IS NOT NULL)
        ),
        CONSTRAINT "CHK_0aeb94fc20a8b5f808f46561c4" CHECK (jsonb_typeof("payload") = 'object'),
        CONSTRAINT "FK_4f1f02a761b4e4fe442b7b653f6" FOREIGN KEY ("applyEventId", "migration")
          REFERENCES "migration_audit_event" ("id", "migration") ON DELETE RESTRICT ON UPDATE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_b2ddb93ddceb82a4fe952d7270"
      ON "migration_audit_event" ("migration", "id")
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "rejectMigrationAuditMutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'migration audit records are append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "validateMigrationAuditEventInsert"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."eventType" = 'Rollback' AND NOT EXISTS (
          SELECT 1 FROM "migration_audit_event"
          WHERE "id" = NEW."applyEventId"
            AND "migration" = NEW."migration"
            AND "eventType" = 'Apply'
        ) THEN
          RAISE EXCEPTION 'rollback must reference an apply event from the same migration';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_migration_audit_event_validate_insert" ON "migration_audit_event"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_migration_audit_event_validate_insert"
      BEFORE INSERT ON "migration_audit_event"
      FOR EACH ROW EXECUTE FUNCTION "validateMigrationAuditEventInsert"()
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_migration_audit_event_immutable" ON "migration_audit_event"`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_migration_audit_event_immutable"
      BEFORE UPDATE OR DELETE ON "migration_audit_event"
      FOR EACH ROW EXECUTE FUNCTION "rejectMigrationAuditMutation"()
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_migration_audit_event_no_truncate" ON "migration_audit_event"`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_migration_audit_event_no_truncate"
      BEFORE TRUNCATE ON "migration_audit_event"
      FOR EACH STATEMENT EXECUTE FUNCTION "rejectMigrationAuditMutation"()
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_migration_audit_lock_immutable" ON "migration_audit_lock"`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_migration_audit_lock_immutable"
      BEFORE UPDATE OR DELETE ON "migration_audit_lock"
      FOR EACH ROW EXECUTE FUNCTION "rejectMigrationAuditMutation"()
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_migration_audit_lock_no_truncate" ON "migration_audit_lock"`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_migration_audit_lock_no_truncate"
      BEFORE TRUNCATE ON "migration_audit_lock"
      FOR EACH STATEMENT EXECUTE FUNCTION "rejectMigrationAuditMutation"()
    `);
  }

  /**
   * Intentionally retained: audit authority and lock rows must outlive the business migrations they record.
   */
  async down() {}
};
