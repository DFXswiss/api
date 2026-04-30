const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RenamedDates1640871093160 {
    name = 'RenamedDates1640871093160'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "date"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "timeStamp"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "inputDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "outputDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "outputDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "inputDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "timeStamp" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "date" nvarchar(256)`);
    }
}
