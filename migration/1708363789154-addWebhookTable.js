const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addWebhookTable1708363789154 {
    name = 'addWebhookTable1708363789154'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "webhook" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a8fa61d25b908d86d7ab6c2233b" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_98873640532abcaf1768a220907" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "data" nvarchar(MAX) NOT NULL, "reason" nvarchar(256), "sentDate" datetime2, "userId" int, "userDataId" int, CONSTRAINT "PK_e6765510c2d078db49632b59020" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "webhook" ADD CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c" FOREIGN KEY ("userId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "webhook" ADD CONSTRAINT "FK_4112043e14655476ecbc2479594" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "webhook" DROP CONSTRAINT "FK_4112043e14655476ecbc2479594"`);
        await queryRunner.query(`ALTER TABLE "webhook" DROP CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c"`);
        await queryRunner.query(`DROP TABLE "webhook"`);
    }
}
