const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyColNotNullable1651730232319 {
    name = 'buyColNotNullable1651730232319'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "buyId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "buyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
