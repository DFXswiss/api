const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCfpVotes1644245381979 {
    name = 'AddedCfpVotes1644245381979'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "cfpVotes" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "cfpVotes"`);
    }
}
