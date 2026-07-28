/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds append-only before/after audit data for virtual-IBAN lifecycle/ownership changes and makes
 * issuance-intent ownership moves reconstructible.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddVirtualIbanLifecycleEvent1785100000000 {
  name = 'AddVirtualIbanLifecycleEvent1785100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`ALTER TABLE "virtual_iban_issuance_event" ADD "previousUserDataId" integer`);
    await queryRunner.query(`ALTER TABLE "virtual_iban_issuance_event" ADD "nextUserDataId" integer`);
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "previousUserDataId" = "userDataId",
          "nextUserDataId" = "userDataId"
    `);
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ALTER COLUMN "previousUserDataId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ALTER COLUMN "nextUserDataId" SET NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "virtual_iban_lifecycle_event" (
        "id" SERIAL NOT NULL,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "virtualIbanId" integer NOT NULL,
        "previousUserDataId" integer NOT NULL,
        "nextUserDataId" integer NOT NULL,
        "previousActive" boolean NOT NULL,
        "nextActive" boolean NOT NULL,
        "previousStatus" character varying(256),
        "nextStatus" character varying(256),
        "previousDeactivatedAt" TIMESTAMP,
        "nextDeactivatedAt" TIMESTAMP,
        "transitionedAt" TIMESTAMP NOT NULL,
        "reason" text NOT NULL,
        CONSTRAINT "PK_d0317777ccd2368e4d6aa08d0f0" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8323405c2bd05d6f4d8e5a4589" ON "virtual_iban_lifecycle_event" ("virtualIbanId") `,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const rows = await queryRunner.query(`
      SELECT (
        (SELECT count(*) FROM "virtual_iban_lifecycle_event") +
        (SELECT count(*) FROM "virtual_iban_issuance_event")
      )::int AS "cnt"
    `);
    const { cnt } = rows.at(0);
    const auditRowCount = Number(cnt);
    if (auditRowCount > 0) {
      throw new Error(
        `AddVirtualIbanLifecycleEvent down(): refusing to destroy ${auditRowCount} append-only audit row(s). ` +
          `Reconcile and archive the lifecycle/issuance history before rollback.`,
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_8323405c2bd05d6f4d8e5a4589"`);
    await queryRunner.query(`DROP TABLE "virtual_iban_lifecycle_event"`);
    await queryRunner.query(`ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "nextUserDataId"`);
    await queryRunner.query(`ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "previousUserDataId"`);
  }
};
