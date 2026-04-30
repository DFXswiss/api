const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemovedMnEnable1655213109083 {
    name = 'RemovedMnEnable1655213109083'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP CONSTRAINT "DF_bb2493b02b73827db0946c32949"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP COLUMN "enabled"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD "enabled" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD CONSTRAINT "DF_bb2493b02b73827db0946c32949" DEFAULT 0 FOR "enabled"`);
    }
}
