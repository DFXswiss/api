/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates the append-only double-entry ledger tables (ledger_account / ledger_tx / ledger_leg).
 * New tables only — no ALTER/INSERT on existing tables (CoA bootstrap + cutover run as code jobs).
 * Integer-cent columns are PostgreSQL `integer` (never bigint → JS string), the single-row balance
 * gate is a CHECK("amountChfSum" = 0) on ledger_tx, and `sourceId` is character varying(64).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLedgerTables1781235331368 {
  name = 'AddLedgerTables1781235331368';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "ledger_account" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(256) NOT NULL, "type" character varying(32) NOT NULL, "currency" character varying(16) NOT NULL, "active" boolean NOT NULL DEFAULT true, "assetId" integer, CONSTRAINT "UQ_b4080ce191f8cc161d447e6f76d" UNIQUE ("name"), CONSTRAINT "PK_34640393ff83dad2b4627d7ae5f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ab36f1dc36f9ec0a1857633190" ON "ledger_account" ("type") `);
    await queryRunner.query(`CREATE INDEX "IDX_6793efdea5c47073f6b5d2af34" ON "ledger_account" ("assetId") `);

    await queryRunner.query(
      `CREATE TABLE "ledger_tx" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "bookingDate" TIMESTAMP NOT NULL, "valueDate" TIMESTAMP NOT NULL, "description" character varying(512), "sourceType" character varying(64) NOT NULL, "sourceId" character varying(64) NOT NULL, "seq" integer NOT NULL DEFAULT 0, "amountChfSum" integer NOT NULL DEFAULT 0, "reversalOfId" integer, CONSTRAINT "UQ_86a66bea626f9a32e1d26a7b136" UNIQUE ("sourceType", "sourceId", "seq"), CONSTRAINT "CHK_dcc2c4dd65621661cdd1f0b370" CHECK ("amountChfSum" = 0), CONSTRAINT "PK_2a5f197e0dbaa656731fee263d8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e27c60c70525be037830f579b4" ON "ledger_tx" ("bookingDate") `);
    await queryRunner.query(`CREATE INDEX "IDX_42c53a01650aaa5e88bb9a3470" ON "ledger_tx" ("reversalOfId") `);

    await queryRunner.query(
      `CREATE TABLE "ledger_leg" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "amount" double precision NOT NULL, "priceChf" double precision, "amountChf" double precision, "amountChfCents" integer NOT NULL DEFAULT 0, "needsMark" boolean NOT NULL DEFAULT false, "txId" integer NOT NULL, "accountId" integer NOT NULL, CONSTRAINT "PK_6566e1943c692f0caad604015d0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_7c939d7bfcc9cc3f71bb3eddd9" ON "ledger_leg" ("txId") `);
    await queryRunner.query(`CREATE INDEX "IDX_b8d0b654d708ff1255a49b7e6e" ON "ledger_leg" ("accountId") `);
    await queryRunner.query(`CREATE INDEX "IDX_91e1f2192fbd0e1681e461eadb" ON "ledger_leg" ("needsMark") `);

    await queryRunner.query(
      `ALTER TABLE "ledger_account" ADD CONSTRAINT "FK_6793efdea5c47073f6b5d2af349" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_tx" ADD CONSTRAINT "FK_42c53a01650aaa5e88bb9a34700" FOREIGN KEY ("reversalOfId") REFERENCES "ledger_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_leg" ADD CONSTRAINT "FK_7c939d7bfcc9cc3f71bb3eddd90" FOREIGN KEY ("txId") REFERENCES "ledger_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_leg" ADD CONSTRAINT "FK_b8d0b654d708ff1255a49b7e6e5" FOREIGN KEY ("accountId") REFERENCES "ledger_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "ledger_leg" DROP CONSTRAINT "FK_b8d0b654d708ff1255a49b7e6e5"`);
    await queryRunner.query(`ALTER TABLE "ledger_leg" DROP CONSTRAINT "FK_7c939d7bfcc9cc3f71bb3eddd90"`);
    await queryRunner.query(`ALTER TABLE "ledger_tx" DROP CONSTRAINT "FK_42c53a01650aaa5e88bb9a34700"`);
    await queryRunner.query(`ALTER TABLE "ledger_account" DROP CONSTRAINT "FK_6793efdea5c47073f6b5d2af349"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_91e1f2192fbd0e1681e461eadb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b8d0b654d708ff1255a49b7e6e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7c939d7bfcc9cc3f71bb3eddd9"`);
    await queryRunner.query(`DROP TABLE "ledger_leg"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_42c53a01650aaa5e88bb9a3470"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e27c60c70525be037830f579b4"`);
    await queryRunner.query(`DROP TABLE "ledger_tx"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_6793efdea5c47073f6b5d2af34"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ab36f1dc36f9ec0a1857633190"`);
    await queryRunner.query(`DROP TABLE "ledger_account"`);
  }
};
