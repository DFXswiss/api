const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeWallet1703085045337 {
    name = 'addFeeWallet1703085045337'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "walletId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD CONSTRAINT "FK_e37c279a7e4fdc3220f39814c5b" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "FK_e37c279a7e4fdc3220f39814c5b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "walletId"`);
    }
}
