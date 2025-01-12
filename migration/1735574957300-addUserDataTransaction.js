const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataTransaction1735574957300 {
    name = 'addUserDataTransaction1735574957300'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD CONSTRAINT "FK_1e5036f71c59cd6e514280f2719" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "walletId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD CONSTRAINT "FK_900eb6b5efaecf57343e4c0e79d" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP CONSTRAINT "FK_900eb6b5efaecf57343e4c0e79d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "walletId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP CONSTRAINT "FK_1e5036f71c59cd6e514280f2719"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "userDataId"`);
    }
}
