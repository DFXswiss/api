/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddArchiveAnchoring1781788436511 {
    name = 'AddArchiveAnchoring1781788436511'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "archive_batch" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "merkleRoot" character varying(64) NOT NULL, "otsProof" text, "bitcoinHeight" integer, "status" character varying(256) NOT NULL DEFAULT 'pendingBtc', CONSTRAINT "PK_06f898016522a01c619a214aa18" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "archive_file" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "bucket" character varying(256) NOT NULL, "name" character varying(256) NOT NULL, "sha256" character varying(64) NOT NULL, "leafIndex" integer, "batchId" integer, CONSTRAINT "PK_17e252452a46a911a66d67dd50d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e7da94bafd8e348ead75dcb000" ON "archive_file" ("bucket", "name") `);
        await queryRunner.query(`CREATE INDEX "IDX_4065eeb67cf015dc7327499de9" ON "archive_file" ("batchId") `);
        await queryRunner.query(`ALTER TABLE "archive_file" ADD CONSTRAINT "FK_4065eeb67cf015dc7327499de94" FOREIGN KEY ("batchId") REFERENCES "archive_batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "archive_file" DROP CONSTRAINT "FK_4065eeb67cf015dc7327499de94"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4065eeb67cf015dc7327499de9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e7da94bafd8e348ead75dcb000"`);
        await queryRunner.query(`DROP TABLE "archive_file"`);
        await queryRunner.query(`DROP TABLE "archive_batch"`);
    }
}
