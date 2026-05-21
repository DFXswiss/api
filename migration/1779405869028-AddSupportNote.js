/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportNote1779405869028 {
    name = 'AddSupportNote1779405869028'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "support_note" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "department" character varying(256) NOT NULL, "authorId" integer NOT NULL, "authorMail" character varying(256) NOT NULL, "subject" character varying(256), "content" text NOT NULL, "userDataId" integer, CONSTRAINT "PK_50d71a126818b986dfd11f3cc4c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1824182fbb53ca85959eedda54" ON "support_note" ("userDataId") `);
        await queryRunner.query(`ALTER TABLE "support_note" ADD CONSTRAINT "FK_1824182fbb53ca85959eedda54d" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_note" DROP CONSTRAINT "FK_1824182fbb53ca85959eedda54d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1824182fbb53ca85959eedda54"`);
        await queryRunner.query(`DROP TABLE "support_note"`);
    }
}
