/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPartnerConsent1781031292273 {
    name = 'AddPartnerConsent1781031292273'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "partner_consent" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "topic" character varying(256) NOT NULL, "version" integer NOT NULL, "partnerId" integer NOT NULL, "userDataId" integer NOT NULL, CONSTRAINT "PK_67707b8dfd2fe11b9709673d326" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d7d7bafbd3629778eb1376d1ab" ON "partner_consent" ("partnerId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f6629dbad0f2d3a7cab345f229" ON "partner_consent" ("userDataId") `);
        await queryRunner.query(`ALTER TABLE "partner_consent" ADD CONSTRAINT "FK_d7d7bafbd3629778eb1376d1ab3" FOREIGN KEY ("partnerId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "partner_consent" ADD CONSTRAINT "FK_f6629dbad0f2d3a7cab345f2294" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "partner_consent" DROP CONSTRAINT "FK_f6629dbad0f2d3a7cab345f2294"`);
        await queryRunner.query(`ALTER TABLE "partner_consent" DROP CONSTRAINT "FK_d7d7bafbd3629778eb1376d1ab3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6629dbad0f2d3a7cab345f229"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d7d7bafbd3629778eb1376d1ab"`);
        await queryRunner.query(`DROP TABLE "partner_consent"`);
    }
}
