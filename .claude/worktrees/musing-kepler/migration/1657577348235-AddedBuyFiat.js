const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBuyFiat1657577348235 {
    name = 'AddedBuyFiat1657577348235'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "buy_fiat" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_c022cde69d029bd0e0dc631289c" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_43d231812a176b6770389cb8bc8" DEFAULT getdate(), "cryptoInputId" int NOT NULL, "sellId" int NOT NULL, CONSTRAINT "PK_c34bd02937a743168a974d5b93b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_82e290b1157691f3f3ccf57dc2" ON "buy_fiat" ("cryptoInputId") WHERE "cryptoInputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ALTER COLUMN "type" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD CONSTRAINT "FK_82e290b1157691f3f3ccf57dc2a" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD CONSTRAINT "FK_17cdc5fdbc341100fde982dcd29" FOREIGN KEY ("sellId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP CONSTRAINT "FK_17cdc5fdbc341100fde982dcd29"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP CONSTRAINT "FK_82e290b1157691f3f3ccf57dc2a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ALTER COLUMN "type" nvarchar(256)`);
        await queryRunner.query(`DROP INDEX "REL_82e290b1157691f3f3ccf57dc2" ON "buy_fiat"`);
        await queryRunner.query(`DROP TABLE "buy_fiat"`);
    }
}
