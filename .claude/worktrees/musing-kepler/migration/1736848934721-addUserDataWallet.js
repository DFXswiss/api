const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataWallet1736848934721 {
    name = 'addUserDataWallet1736848934721'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "walletId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_dcf41efbd8bd1f2a80f369028b2" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
    
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_dcf41efbd8bd1f2a80f369028b2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "walletId"`);
    }
}
