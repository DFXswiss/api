const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentLink1721741056118 {
    name = 'PaymentLink1721741056118'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "payment_activation" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_36a04f2fac338022b96997f60bc" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b560105166e38eda1e0a263cb02" DEFAULT getdate(), "status" nvarchar(255) NOT NULL, "method" nvarchar(255) NOT NULL, "amount" float NOT NULL, "paymentRequest" nvarchar(MAX) NOT NULL, "expiryDate" datetime2 NOT NULL, "assetId" int NOT NULL, "paymentId" int NOT NULL, CONSTRAINT "PK_c384b70d1c328dea8022cf19d36" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5c3140738a4bd749b6bdd05331" ON "payment_activation" ("method", "assetId", "amount") WHERE status = 'Pending'`);
        await queryRunner.query(`CREATE TABLE "payment_link" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_793c78643075b23b2d902fff1f5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_1a6644fd008b4a95f060fff3fce" DEFAULT getdate(), "uniqueId" nvarchar(256) NOT NULL, "externalId" nvarchar(256), "status" nvarchar(256) NOT NULL, "routeId" int, CONSTRAINT "UQ_0c99ecdf97ecffa4ab1b82b0470" UNIQUE ("uniqueId"), CONSTRAINT "PK_0f9650efa36bead30593038140c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment_link_payment" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_3ec5e7ebfa65797d48c69ea96ca" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_6c47172d323f4e858c5be393b87" DEFAULT getdate(), "uniqueId" nvarchar(256) NOT NULL, "externalId" nvarchar(256), "status" nvarchar(256) NOT NULL, "amount" float NOT NULL, "mode" nvarchar(256) NOT NULL, "expiryDate" datetime2 NOT NULL, "transferAmounts" nvarchar(MAX) NOT NULL, "linkId" int, "currencyId" int NOT NULL, "cryptoInputId" int, CONSTRAINT "UQ_3085199fb938c08f99e876f94f8" UNIQUE ("uniqueId"), CONSTRAINT "PK_90e33dca5065df5f0877a0c43f7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment" ("linkId") WHERE status = 'Pending'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a31317b642d8c22787cd61dce9" ON "payment_link_payment" ("cryptoInputId") WHERE "cryptoInputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "asset" ADD "paymentEnabled" bit NOT NULL CONSTRAINT "DF_832b433146d8544233bbe00b059" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "paymentLinksAllowed" bit NOT NULL CONSTRAINT "DF_7af18b48c4ac4235a92629a3ff8" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD CONSTRAINT "FK_5ac102287f50d730587224283cf" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD CONSTRAINT "FK_1968cc8772398abbe1e97b8a94e" FOREIGN KEY ("paymentId") REFERENCES "payment_link_payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_bf8d7cc746a822b493009acc332" FOREIGN KEY ("linkId") REFERENCES "payment_link"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_d1f710811ec3f2352799bea96d7" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_a31317b642d8c22787cd61dce93" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_a31317b642d8c22787cd61dce93"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_d1f710811ec3f2352799bea96d7"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_bf8d7cc746a822b493009acc332"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "FK_1968cc8772398abbe1e97b8a94e"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "FK_5ac102287f50d730587224283cf"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_7af18b48c4ac4235a92629a3ff8"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "paymentLinksAllowed"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_832b433146d8544233bbe00b059"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "paymentEnabled"`);
        await queryRunner.query(`DROP INDEX "REL_a31317b642d8c22787cd61dce9" ON "payment_link_payment"`);
        await queryRunner.query(`DROP INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment"`);
        await queryRunner.query(`DROP TABLE "payment_link_payment"`);
        await queryRunner.query(`DROP TABLE "payment_link"`);
        await queryRunner.query(`DROP INDEX "IDX_5c3140738a4bd749b6bdd05331" ON "payment_activation"`);
        await queryRunner.query(`DROP TABLE "payment_activation"`);
    }
}
