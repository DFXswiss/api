const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeUserCfpVotes1694431107346 {
    name = 'removeUserCfpVotes1694431107346'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "cfpVotes"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "cfpVotes" nvarchar(MAX)`);
    }
}
