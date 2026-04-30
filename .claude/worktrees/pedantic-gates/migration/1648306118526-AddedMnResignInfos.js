const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedMnResignInfos1648306118526 {
    name = 'AddedMnResignInfos1648306118526'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD "resignDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD "resignHash" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP COLUMN "resignHash"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP COLUMN "resignDate"`);
    }
}
