const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeUserWalletFee1702166865606 {
    name = 'removeUserWalletFee1702166865606'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "buyFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "sellFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "cryptoFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "buyFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "sellFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "cryptoFee"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "cryptoFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "sellFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "buyFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "cryptoFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "sellFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "buyFee" float`);
    }
}
