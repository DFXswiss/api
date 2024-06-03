const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class WebhookImprovements1717417655338 {
    name = 'WebhookImprovements1717417655338'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "webhookConfig" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycClients" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD "walletId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "userId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_4112043e14655476ecbc2479594" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_ac42e3c9f043be4b94fc55c3c80"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_4112043e14655476ecbc2479594"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ALTER COLUMN "userId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP COLUMN "walletId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP COLUMN "userDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycClients"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "webhookConfig"`);
    }
}
