/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMros1776932301279 {
    name = 'AddMros1776932301279'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "mros" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_mros_updated" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_mros_created" DEFAULT getdate(), "status" nvarchar(256) NOT NULL, "submissionDate" datetime2, "authorityReference" nvarchar(256), "caseManager" nvarchar(256) NOT NULL, "userDataId" int NOT NULL, CONSTRAINT "PK_mros" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "mros" ADD CONSTRAINT "FK_mros_userData" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "mros" DROP CONSTRAINT "FK_mros_userData"`);
        await queryRunner.query(`DROP TABLE "mros"`);
    }
}
