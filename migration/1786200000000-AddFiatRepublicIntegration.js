/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Schema for the Fiat Republic fiat rail.
 *
 * Two claim tables and the per-rail payout columns on `fiat_output`, mirroring what the Bank Frick
 * rail carries. Purely additive and inert on its own: nothing reads or writes any of it until the
 * Fiat Republic credentials AND the environment release flags are set (see `fiat-republic.config.ts`),
 * so this migration can ship long before go-live.
 *
 * No bank row is created here. The Fiat Republic collection IBAN is live data that does not exist yet;
 * registering it is an operational step documented in `docs/fiat-republic-operations.md`.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFiatRepublicIntegration1786200000000 {
  name = 'AddFiatRepublicIntegration1786200000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Maps a DFX customer to their Fiat Republic end user. The unique index on userDataId is the
    // mutex that makes end-user creation exactly-once across processes.
    await queryRunner.query(
      `CREATE TABLE "fiat_republic_end_user" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "userDataId" integer NOT NULL, "endUserId" character varying(256), "state" character varying(256) NOT NULL DEFAULT 'Pending', "error" character varying(256), CONSTRAINT "PK_b0c5684cf15d93f45172fc3a71a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9acb64c3490b9a9892a870ed07" ON "fiat_republic_end_user" ("userDataId") `,
    );

    // Caches the Fiat Republic payee per (end user, IBAN, name). The name is part of the key because
    // Verification of Payee validates the holder name against the IBAN — a payout to the same IBAN
    // under a different name is a different payee.
    await queryRunner.query(
      `CREATE TABLE "fiat_republic_payee" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "endUserId" character varying(256) NOT NULL, "iban" character varying(256) NOT NULL, "name" character varying(256) NOT NULL, "payeeId" character varying(256), "status" character varying(256), CONSTRAINT "PK_8637773fae57f2e9d2c6a96a894" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f9df8f2d98c46e975e60001a83" ON "fiat_republic_payee" ("endUserId", "iban", "name") `,
    );

    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicCustomId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicPaymentId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicPaymentStatus" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicError" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicReference" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "fiatRepublicMatchLevel" character varying(256)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicMatchLevel"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicReference"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicError"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicPaymentStatus"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicPaymentId"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "fiatRepublicCustomId"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_f9df8f2d98c46e975e60001a83"`);
    await queryRunner.query(`DROP TABLE "fiat_republic_payee"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9acb64c3490b9a9892a870ed07"`);
    await queryRunner.query(`DROP TABLE "fiat_republic_end_user"`);
  }
};
