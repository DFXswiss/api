const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class Initial1629931929472 {
    name = 'Initial1629931929472'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "user_data" ("id" int NOT NULL IDENTITY(1,1), "name" varchar(256) NOT NULL, "location" varchar(256) NOT NULL, "nameCheck" varchar(256) NOT NULL CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4" DEFAULT 'NA', "updated" datetime2 NOT NULL CONSTRAINT "DF_a169ce83cdce6cfb1dda084d976" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_92524abcc8a67b5b339b8ab65f3" DEFAULT getdate(), "countryId" int, CONSTRAINT "PK_73a2ae063ee34712f94b8248ced" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "user_data" ("name", "location") `);
        await queryRunner.query(`CREATE TABLE "country" ("id" int NOT NULL IDENTITY(1,1), "symbol" varchar(10) NOT NULL, "name" varchar(256) NOT NULL, "enable" bit NOT NULL CONSTRAINT "DF_f788e9165cd7ce4404c53f3c661" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_77d13ee65ce17510d8a0eb04361" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_0f2b6cb5923823466039624b8dc" DEFAULT getdate(), CONSTRAINT "UQ_a311ea2c04056cbfb4de490d827" UNIQUE ("symbol"), CONSTRAINT "PK_bf6e37c231c4f4ea56dcd887269" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "language" ("id" int NOT NULL IDENTITY(1,1), "symbol" varchar(10) NOT NULL, "name" varchar(256) NOT NULL, "foreignName" varchar(256) NOT NULL, "enable" bit NOT NULL CONSTRAINT "DF_0ac510f8ae82e96ad97a6c29186" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_0d91272b3978057c88b996005e3" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_9922112bb5895a747be790577aa" DEFAULT getdate(), CONSTRAINT "UQ_61337a8ce78f5a5d8550dbd3d58" UNIQUE ("symbol"), CONSTRAINT "PK_cc0a99e710eb3733f6fb42b1d4c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "deposit" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256) NOT NULL, "used" bit NOT NULL CONSTRAINT "DF_1356536ce482900cc64af6ed689" DEFAULT 0, "updated" datetime2 NOT NULL CONSTRAINT "DF_41566fb04581e65059c3d3da6e6" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_324a41f9087b363db6b8505c85b" DEFAULT getdate(), CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc" UNIQUE ("address"), CONSTRAINT "PK_6654b4be449dadfd9d03a324b61" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256), "fiatInCHF" float, "received" datetime2, "status" varchar(256) NOT NULL CONSTRAINT "DF_3af0086da18f32ac05a52e56390" DEFAULT 'Unprocessed', "info" varchar(256), "errorCode" varchar(256) NOT NULL CONSTRAINT "DF_182a55f4c8516f8ef50015f6ae0" DEFAULT 'NA', "updated" datetime2 NOT NULL CONSTRAINT "DF_135b25ff8d1ecbe33dab24386ce" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_c41c74d4a96568569c71cffe88e" DEFAULT getdate(), "fiatId" int, "assetId" int, CONSTRAINT "PK_fcaec7df5adf9cac408c686b2ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sell_payment" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256), "fiatInCHF" float, "received" datetime2, "status" varchar(256) NOT NULL CONSTRAINT "DF_d20cac391a081a2bef84f7216db" DEFAULT 'Unprocessed', "info" varchar(256), "errorCode" varchar(256) NOT NULL CONSTRAINT "DF_01eddffc7b1b67b2273cba95c93" DEFAULT 'NA', "updated" datetime2 NOT NULL CONSTRAINT "DF_1b2d57da425b5429cc6ad4e2296" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a48df43b820f053fb07ca3fa2b3" DEFAULT getdate(), "depositAddress" varchar(256), "assetValue" float, "fiatId" int, "assetId" int, "sellId" int, CONSTRAINT "PK_ba27c6e75bfdd3cb4247f7cd133" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sell" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256) NOT NULL, "iban" varchar(256) NOT NULL, "active" bit NOT NULL CONSTRAINT "DF_b388f03cd8680ac0afd782e571a" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_27597d7b3d87554f8cde8fca487" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_7a2763033ef37541535bbaf5dff" DEFAULT getdate(), "fiatId" int, "depositId" int, "userId" int, CONSTRAINT "PK_8cc9d759945a4176103696feedf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "sell" ("iban", "fiatId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_76173e265a3c453f8df30bef9f" ON "sell" ("depositId") WHERE "depositId" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "fiat" ("id" int NOT NULL IDENTITY(1,1), "name" varchar(256) NOT NULL, "enable" bit NOT NULL CONSTRAINT "DF_84e79a4c3552ef2114023fd3af6" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_b2ae4bbd28b490c6c1448aa26bd" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8f58445bdc92ba0b7da46e5b478" DEFAULT getdate(), CONSTRAINT "UQ_9c0b10ac9e8290e4f97ff402af9" UNIQUE ("name"), CONSTRAINT "PK_be672dad81eced4a598ddebcbc1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "log" ("id" int NOT NULL IDENTITY(1,1), "orderId" varchar(256) NOT NULL, "address" varchar(256), "type" varchar(256) NOT NULL, "status" varchar(256), "fiatValue" float, "fiatInCHF" float, "assetValue" float, "direction" varchar(256), "message" varchar(256), "blockchainTx" varchar(256), "updated" datetime2 NOT NULL CONSTRAINT "DF_a513ab9f9b19d68b2c549935834" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_78373526f54f8cfd7d9ec700513" DEFAULT getdate(), "fiatId" int, "assetId" int, "userId" int, CONSTRAINT "UQ_f9b1edfdf8b1f3b891780c14eaa" UNIQUE ("orderId"), CONSTRAINT "PK_350604cbdf991d5930d9e618fbd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "wallet" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256) NOT NULL, "signature" varchar(256) NOT NULL, "mail" varchar(256), "description" varchar(256), "updated" datetime2 NOT NULL CONSTRAINT "DF_fb09ba370efe59a077ccb666826" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_2f026f6cfde1264d133a9da4a40" DEFAULT getdate(), CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53" UNIQUE ("address"), CONSTRAINT "UQ_8a21f1713dbe0211d8493128774" UNIQUE ("signature"), CONSTRAINT "PK_bec464dd8d54c39c54fd32e2334" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user" ("id" int NOT NULL IDENTITY(1,1), "ref" varchar(256) NOT NULL, "address" varchar(256) NOT NULL, "signature" varchar(256) NOT NULL, "usedRef" varchar(256) NOT NULL CONSTRAINT "DF_6b0462af56e2ba6802a9a2d0623" DEFAULT '000-000', "mail" varchar(256), "firstname" varchar(256), "surname" varchar(256), "street" varchar(256), "houseNumber" varchar(256), "location" varchar(256), "zip" varchar(256), "phone" varchar(256), "role" varchar(256) NOT NULL CONSTRAINT "DF_6620cd026ee2b231beac7cfe578" DEFAULT 'User', "status" varchar(256) NOT NULL CONSTRAINT "DF_3d44ccf43b8a0d6b9978affb880" DEFAULT 'NA', "ip" varchar(256) NOT NULL CONSTRAINT "DF_b89d1c9e55e306904fec32aa070" DEFAULT '0.0.0.0', "updated" datetime2 NOT NULL CONSTRAINT "DF_5904a9d40152f354e4c7b0202fb" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8ce4c93ba419b56bd82e533724d" DEFAULT getdate(), "walletId" int, "countryId" int, "languageId" int, "userDataId" int, CONSTRAINT "UQ_3122b4b8709577da50e89b68983" UNIQUE ("address"), CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0" UNIQUE ("signature"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "buy_payment" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256), "fiatInCHF" float, "received" datetime2, "status" varchar(256) NOT NULL CONSTRAINT "DF_aaab397d9f0aa9601af498de7dd" DEFAULT 'Unprocessed', "info" varchar(256), "errorCode" varchar(256) NOT NULL CONSTRAINT "DF_9555c018821e336dfa4c16d71fd" DEFAULT 'NA', "updated" datetime2 NOT NULL CONSTRAINT "DF_ff661541eb59ea12ebd34060f1b" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_1af5189f3f4a88c546f26e9797d" DEFAULT getdate(), "fiatValue" float, "iban" varchar(256), "bankTransactionId" varchar(256) NOT NULL, "fiatId" int, "assetId" int, "buyId" int, CONSTRAINT "UQ_ac2c31ed5995e127fd2f91abf21" UNIQUE ("bankTransactionId"), CONSTRAINT "PK_4ad05474703ee07e88b61b89daa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "buy" ("id" int NOT NULL IDENTITY(1,1), "address" varchar(256) NOT NULL, "iban" varchar(256) NOT NULL, "bankUsage" varchar(256) NOT NULL, "active" bit NOT NULL CONSTRAINT "DF_e6279732f7a7705a740fee29c84" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_1276607f6b0c2f82c3e385e265e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_90cf648ce52cdc624d1d9a06518" DEFAULT getdate(), "userId" int, "assetId" int, CONSTRAINT "UQ_a2691bc8461c21cec282253ea14" UNIQUE ("bankUsage"), CONSTRAINT "PK_634c4687b54f6a44ac0c142adf7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "buy" ("iban", "assetId") `);
        await queryRunner.query(`CREATE TABLE "asset" ("id" int NOT NULL IDENTITY(1,1), "name" varchar(256) NOT NULL, "type" varchar(256) NOT NULL, "buyable" bit NOT NULL CONSTRAINT "DF_02425ec147dfa126bfd6f41c7db" DEFAULT 1, "sellable" bit NOT NULL CONSTRAINT "DF_b5d5bb3aea25a3e735ec3c6a2fe" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_6ed5cbbccf21b8ef558f7ef2de5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_3ee68e53a3e33a8df283f66aada" DEFAULT getdate(), CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f" UNIQUE ("name"), CONSTRAINT "PK_1209d107fe21482beaea51b745e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment" ADD CONSTRAINT "FK_0211a13c2d786d2e8058cc876bc" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment" ADD CONSTRAINT "FK_49effb15a50ea9673ed46601991" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell_payment" ADD CONSTRAINT "FK_a80a7ead3c3992dfdd6584c81d2" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell_payment" ADD CONSTRAINT "FK_12b0ba5ad3bb3758873e0d3785b" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell_payment" ADD CONSTRAINT "FK_934df74fa1dda6185662462f49f" FOREIGN KEY ("sellId") REFERENCES "sell"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell" ADD CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell" ADD CONSTRAINT "FK_76173e265a3c453f8df30bef9f6" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sell" ADD CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "log" ADD CONSTRAINT "FK_5d8bd961f38b0c6f22dff42ae69" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "log" ADD CONSTRAINT "FK_b1508aa7e4928bf3385dd84ec85" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "log" ADD CONSTRAINT "FK_cea2ed3a494729d4b21edbd2983" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_922e8c1d396025973ec81e2a402" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_4aaf6d02199282eb8d3931bff31" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_0b294695467ceecc030f95461c1" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_payment" ADD CONSTRAINT "FK_d396856e2e456dcddf7e2cc08e8" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_payment" ADD CONSTRAINT "FK_254edc54ec377c7fb7695750117" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_payment" ADD CONSTRAINT "FK_c461f5e17fcc45471326f32959f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy" ADD CONSTRAINT "FK_73b6d9b1037a714d3314e038819" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy" ADD CONSTRAINT "FK_ae4cd183a5bb4265a3395af35ce" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy" DROP CONSTRAINT "FK_ae4cd183a5bb4265a3395af35ce"`);
        await queryRunner.query(`ALTER TABLE "buy" DROP CONSTRAINT "FK_73b6d9b1037a714d3314e038819"`);
        await queryRunner.query(`ALTER TABLE "buy_payment" DROP CONSTRAINT "FK_c461f5e17fcc45471326f32959f"`);
        await queryRunner.query(`ALTER TABLE "buy_payment" DROP CONSTRAINT "FK_254edc54ec377c7fb7695750117"`);
        await queryRunner.query(`ALTER TABLE "buy_payment" DROP CONSTRAINT "FK_d396856e2e456dcddf7e2cc08e8"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_0b294695467ceecc030f95461c1"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_4aaf6d02199282eb8d3931bff31"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_922e8c1d396025973ec81e2a402"`);
        await queryRunner.query(`ALTER TABLE "log" DROP CONSTRAINT "FK_cea2ed3a494729d4b21edbd2983"`);
        await queryRunner.query(`ALTER TABLE "log" DROP CONSTRAINT "FK_b1508aa7e4928bf3385dd84ec85"`);
        await queryRunner.query(`ALTER TABLE "log" DROP CONSTRAINT "FK_5d8bd961f38b0c6f22dff42ae69"`);
        await queryRunner.query(`ALTER TABLE "sell" DROP CONSTRAINT "FK_64849ead0a6da6c6a70c55a58da"`);
        await queryRunner.query(`ALTER TABLE "sell" DROP CONSTRAINT "FK_76173e265a3c453f8df30bef9f6"`);
        await queryRunner.query(`ALTER TABLE "sell" DROP CONSTRAINT "FK_46542b36f37a0ea08f59bd0dd04"`);
        await queryRunner.query(`ALTER TABLE "sell_payment" DROP CONSTRAINT "FK_934df74fa1dda6185662462f49f"`);
        await queryRunner.query(`ALTER TABLE "sell_payment" DROP CONSTRAINT "FK_12b0ba5ad3bb3758873e0d3785b"`);
        await queryRunner.query(`ALTER TABLE "sell_payment" DROP CONSTRAINT "FK_a80a7ead3c3992dfdd6584c81d2"`);
        await queryRunner.query(`ALTER TABLE "payment" DROP CONSTRAINT "FK_49effb15a50ea9673ed46601991"`);
        await queryRunner.query(`ALTER TABLE "payment" DROP CONSTRAINT "FK_0211a13c2d786d2e8058cc876bc"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f"`);
        await queryRunner.query(`DROP TABLE "asset"`);
        await queryRunner.query(`DROP INDEX "ibanAsset" ON "buy"`);
        await queryRunner.query(`DROP TABLE "buy"`);
        await queryRunner.query(`DROP TABLE "buy_payment"`);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP TABLE "wallet"`);
        await queryRunner.query(`DROP TABLE "log"`);
        await queryRunner.query(`DROP TABLE "fiat"`);
        await queryRunner.query(`DROP INDEX "REL_76173e265a3c453f8df30bef9f" ON "sell"`);
        await queryRunner.query(`DROP INDEX "ibanAsset" ON "sell"`);
        await queryRunner.query(`DROP TABLE "sell"`);
        await queryRunner.query(`DROP TABLE "sell_payment"`);
        await queryRunner.query(`DROP TABLE "payment"`);
        await queryRunner.query(`DROP TABLE "deposit"`);
        await queryRunner.query(`DROP TABLE "language"`);
        await queryRunner.query(`DROP TABLE "country"`);
        await queryRunner.query(`DROP INDEX "nameLocation" ON "user_data"`);
        await queryRunner.query(`DROP TABLE "user_data"`);
    }
}
