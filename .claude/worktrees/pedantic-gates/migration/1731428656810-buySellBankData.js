const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buySellBankData1731428656810 {
    name = 'buySellBankData1731428656810'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "bankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "bankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_45e407e37234f3420b8f1d71a5b" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_387be31cb4b12c7e8dcd6485d50" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_387be31cb4b12c7e8dcd6485d50"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_45e407e37234f3420b8f1d71a5b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "bankDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "bankDataId"`);
    }
}
