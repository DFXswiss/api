const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SellUpdate1634776207411 {
    name = 'SellUpdate1634776207411'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAsset" ON "dbo"."sell"`);
        await queryRunner.query(`DROP INDEX "REL_76173e265a3c453f8df30bef9f" ON "dbo"."sell"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "DF_1356536ce482900cc64af6ed689"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP COLUMN "used"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP COLUMN "address"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_76173e265a3c453f8df30bef9f6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "fiatId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "depositId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "userId" int NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_76173e265a3c453f8df30bef9f" ON "dbo"."sell" ("depositId") WHERE ([depositId] IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanFiat" ON "dbo"."sell" ("iban", "fiatId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_76173e265a3c453f8df30bef9f6" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da" FOREIGN KEY ("userId") REFERENCES ."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_76173e265a3c453f8df30bef9f6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04"`);
        await queryRunner.query(`DROP INDEX "ibanFiat" ON "dbo"."sell"`);
        await queryRunner.query(`DROP INDEX "REL_76173e265a3c453f8df30bef9f" ON "dbo"."sell"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "userId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "depositId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "fiatId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da" FOREIGN KEY ("userId") REFERENCES ."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_76173e265a3c453f8df30bef9f6" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD "used" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "DF_1356536ce482900cc64af6ed689" DEFAULT 0 FOR "used"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_76173e265a3c453f8df30bef9f" ON "dbo"."sell" ("depositId") WHERE ([depositId] IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "dbo"."sell" ("iban", "fiatId") `);
    }
}
