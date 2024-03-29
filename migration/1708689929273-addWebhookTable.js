const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addWebhookTable1708689929273 {
    name = 'addWebhookTable1708689929273'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "webhook" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a8fa61d25b908d86d7ab6c2233b" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_98873640532abcaf1768a220907" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "data" nvarchar(MAX) NOT NULL, "reason" nvarchar(256), "lastTryDate" datetime2, "isComplete" bit NOT NULL CONSTRAINT "DF_eb7a642d7d3dc568157da5d1156" DEFAULT 0, "userId" int NOT NULL, CONSTRAINT "PK_e6765510c2d078db49632b59020" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "webhook" ADD CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "webhook" DROP CONSTRAINT "FK_f272c8c8805969e6a6449c77b3c"`);
        await queryRunner.query(`DROP TABLE "webhook"`);
    }
}
