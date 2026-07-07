/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTransactionAmlCheck1783120644000 {
    name = 'AddTransactionAmlCheck1783120644000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking every "transaction" write if the FK's SHARE ROW
        // EXCLUSIVE lock on the hot "transaction" table is contended at deploy time: a timeout rolls the
        // migration back (transaction mode 'all') and Nest retries it rather than hanging app boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`CREATE TABLE "transaction_aml_check" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "entityType" character varying(256) NOT NULL, "entityId" integer NOT NULL, "source" character varying(256) NOT NULL, "previousAmlCheck" character varying(256), "amlCheck" character varying(256), "previousAmlReason" character varying(256), "amlReason" character varying(256), "amlResponsible" character varying(256), "comment" text, "priceDefinitionAllowedDate" TIMESTAMP, "highRisk" boolean, "transactionId" integer NOT NULL, CONSTRAINT "PK_dbbbb95a1c29e1bbd0abadbb445" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0229b3ad51f3d5251d63c78ab4" ON "transaction_aml_check" ("transactionId") `);
        await queryRunner.query(`ALTER TABLE "transaction_aml_check" ADD CONSTRAINT "FK_0229b3ad51f3d5251d63c78ab4f" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction_aml_check" DROP CONSTRAINT "FK_0229b3ad51f3d5251d63c78ab4f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0229b3ad51f3d5251d63c78ab4"`);
        await queryRunner.query(`DROP TABLE "transaction_aml_check"`);
    }
}
