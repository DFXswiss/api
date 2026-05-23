/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportIssueTemplate1779454406844 {
    name = 'AddSupportIssueTemplate1779454406844'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "support_issue_template" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(256) NOT NULL, "contentDe" text NOT NULL, "contentEn" text, "authorId" integer NOT NULL, "authorMail" character varying(256) NOT NULL, CONSTRAINT "PK_caa8aaf252518b9cd9272d84ae4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0f07bfe54fccedb688641354d2" ON "support_issue_template" ("name") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_0f07bfe54fccedb688641354d2"`);
        await queryRunner.query(`DROP TABLE "support_issue_template"`);
    }
}
