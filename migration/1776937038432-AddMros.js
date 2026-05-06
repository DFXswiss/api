/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMros1776937038432 {
    name = 'AddMros1776937038432'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "mros" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_f6ade72c09ca260e3ce42ba0781" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_d7ed4994a2c27be9ea6c21b1c21" DEFAULT getdate(), "status" nvarchar(256) NOT NULL, "submissionDate" datetime2, "authorityReference" nvarchar(256), "caseManager" nvarchar(256) NOT NULL, "userDataId" int NOT NULL, CONSTRAINT "PK_48a5606a1194ef6f78c24999754" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "mros" ADD CONSTRAINT "FK_021227644566f36c31912257a39" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "mros" DROP CONSTRAINT "FK_021227644566f36c31912257a39"`);
        await queryRunner.query(`DROP TABLE "mros"`);
    }
}
