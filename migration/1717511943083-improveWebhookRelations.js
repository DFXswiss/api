const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class improveWebhookRelations1717511943083 {
    name = 'improveWebhookRelations1717511943083'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD "error" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_4112043e14655476ecbc2479594"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "userDataId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "walletId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_4112043e14655476ecbc2479594" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_4112043e14655476ecbc2479594"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "walletId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_4112043e14655476ecbc2479594" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP COLUMN "error"`);
    }
}
