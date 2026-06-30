/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddScorechainScreening1782814058854 {
    name = 'AddScorechainScreening1782814058854'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "scorechain_screening" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "objectType" character varying(256) NOT NULL, "objectId" character varying(256) NOT NULL, "blockchain" character varying(256) NOT NULL, "analysisType" character varying(256) NOT NULL, "context" character varying(256) NOT NULL, "riskScore" double precision, "severity" character varying(256), "signatureValid" boolean NOT NULL DEFAULT false, "scorechainRef" character varying(256), "riskIndicators" text, "rawResponse" text, CONSTRAINT "PK_c7fbc4f85f59d3ee69582060016" PRIMARY KEY ("id"))`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "scorechain_screening"`);
    }
}
