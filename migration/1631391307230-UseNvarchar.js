const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UseNvarchar1631391307230 {
    name = 'UseNvarchar1631391307230'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "UQ_a311ea2c04056cbfb4de490d827"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ALTER COLUMN "symbol" nvarchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD CONSTRAINT "UQ_a311ea2c04056cbfb4de490d827" UNIQUE ("symbol")`);

        await queryRunner.query(`ALTER TABLE "dbo"."country" ALTER COLUMN "name" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."language" DROP CONSTRAINT "UQ_61337a8ce78f5a5d8550dbd3d58"`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "symbol" nvarchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ADD CONSTRAINT "UQ_61337a8ce78f5a5d8550dbd3d58" UNIQUE ("symbol")`);

        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "foreignName" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "address" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_3af0086da18f32ac05a52e56390"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_3af0086da18f32ac05a52e56390" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "info" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_182a55f4c8516f8ef50015f6ae0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "errorCode" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_182a55f4c8516f8ef50015f6ae0" DEFAULT 'NA' for "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "address" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_d20cac391a081a2bef84f7216db"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_d20cac391a081a2bef84f7216db" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "info" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_01eddffc7b1b67b2273cba95c93"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "errorCode" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_01eddffc7b1b67b2273cba95c93" DEFAULT 'NA' FOR "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "depositAddress" nvarchar(256)`);

        await queryRunner.query(`DROP INDEX "ibanAsset" ON "dbo"."sell"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "iban" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "UQ_9c0b10ac9e8290e4f97ff402af9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD CONSTRAINT "UQ_9c0b10ac9e8290e4f97ff402af9" UNIQUE ("name")`);

        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "UQ_f9b1edfdf8b1f3b891780c14eaa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "orderId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "UQ_f9b1edfdf8b1f3b891780c14eaa" UNIQUE ("orderId")`);

        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "address" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "type" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "status" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "direction" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "message" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "blockchainTx" nvarchar(256)`);

        await queryRunner.query(`DROP INDEX "nameLocation" ON "dbo"."bank_data"`);

        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "location" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "country" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "nameCheck" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4" DEFAULT 'NA' FOR "nameCheck"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "nameCheckOverrideComment" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "kycStatus" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba" DEFAULT 'NA' FOR "kycStatus"`);

        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_8a21f1713dbe0211d8493128774"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "signature" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_8a21f1713dbe0211d8493128774" UNIQUE ("signature")`);

        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "description" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "ref" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_3122b4b8709577da50e89b68983"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_3122b4b8709577da50e89b68983" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0" UNIQUE ("signature")`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_6b0462af56e2ba6802a9a2d0623"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "usedRef" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_6b0462af56e2ba6802a9a2d0623" DEFAULT '000-000' FOR "usedRef"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "firstname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "surname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "street" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "houseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "location" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "zip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "phone" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_6620cd026ee2b231beac7cfe578"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "role" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_6620cd026ee2b231beac7cfe578" DEFAULT 'User' FOR "role"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_3d44ccf43b8a0d6b9978affb880"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_3d44ccf43b8a0d6b9978affb880" DEFAULT 'NA' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_b89d1c9e55e306904fec32aa070"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "ip" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_b89d1c9e55e306904fec32aa070" DEFAULT '0.0.0.0' FOR "ip"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "address" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_aaab397d9f0aa9601af498de7dd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_aaab397d9f0aa9601af498de7dd" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "info" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_9555c018821e336dfa4c16d71fd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "errorCode" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_9555c018821e336dfa4c16d71fd" DEFAULT 'NA' FOR "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "iban" nvarchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "UQ_ac2c31ed5995e127fd2f91abf21"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "bankTransactionId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "UQ_ac2c31ed5995e127fd2f91abf21" UNIQUE ("bankTransactionId")`);

        await queryRunner.query(`DROP INDEX "ibanAddressAsset" ON "dbo"."buy"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "iban" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "UQ_a2691bc8461c21cec282253ea14"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankUsage" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "UQ_a2691bc8461c21cec282253ea14" UNIQUE ("bankUsage")`);

        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f" UNIQUE ("name")`);

        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "type" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ref" nvarchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."ref" DROP CONSTRAINT "UQ_ca2ec1ac9b89120336cdcb4cdcb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ip" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ADD CONSTRAINT "UQ_ca2ec1ac9b89120336cdcb4cdcb" UNIQUE ("ip")`);

        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "dbo"."sell" ("iban", "fiatId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "dbo"."bank_data" ("name", "location") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAddressAsset" ON "dbo"."buy" ("iban", "assetId", "address") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAddressAsset" ON "dbo"."buy"`);
        await queryRunner.query(`DROP INDEX "nameLocation" ON "dbo"."bank_data"`);
        await queryRunner.query(`DROP INDEX "ibanAsset" ON "dbo"."sell"`);

        await queryRunner.query(`ALTER TABLE "dbo"."ref" DROP CONSTRAINT "UQ_ca2ec1ac9b89120336cdcb4cdcb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ip" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ADD CONSTRAINT "UQ_ca2ec1ac9b89120336cdcb4cdcb" UNIQUE ("ip")`);

        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ref" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "type" varchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "name" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f" UNIQUE ("name")`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "UQ_a2691bc8461c21cec282253ea14"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankUsage" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "UQ_a2691bc8461c21cec282253ea14" UNIQUE ("bankUsage")`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "iban" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "address" varchar(256) NOT NULL`);

        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAddressAsset" ON "dbo"."buy" ("iban", "assetId", "address") `);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "UQ_ac2c31ed5995e127fd2f91abf21"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "bankTransactionId" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "UQ_ac2c31ed5995e127fd2f91abf21" UNIQUE ("bankTransactionId")`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "iban" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_9555c018821e336dfa4c16d71fd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "errorCode" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_9555c018821e336dfa4c16d71fd" DEFAULT 'NA' FOR "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "info" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_aaab397d9f0aa9601af498de7dd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "status" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_aaab397d9f0aa9601af498de7dd" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ALTER COLUMN "address" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_b89d1c9e55e306904fec32aa070"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "ip" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_b89d1c9e55e306904fec32aa070" DEFAULT '0.0.0.0' FOR "ip"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_3d44ccf43b8a0d6b9978affb880"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "status" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_3d44ccf43b8a0d6b9978affb880" DEFAULT 'NA' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_6620cd026ee2b231beac7cfe578"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "role" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_6620cd026ee2b231beac7cfe578" DEFAULT 'User' FOR "role"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "phone" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "zip" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "location" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "houseNumber" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "street" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "surname" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "firstname" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "mail" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_6b0462af56e2ba6802a9a2d0623"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "usedRef" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_6b0462af56e2ba6802a9a2d0623" DEFAULT '000-000' FOR "usedRef"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0" UNIQUE ("signature")`);
        
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_3122b4b8709577da50e89b68983"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "address" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_3122b4b8709577da50e89b68983" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "ref" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "description" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "mail" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_8a21f1713dbe0211d8493128774"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "signature" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_8a21f1713dbe0211d8493128774" UNIQUE ("signature")`);

        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "kycStatus" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba" DEFAULT 'NA' FOR "kycStatus"`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "nameCheckOverrideComment" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "nameCheck" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4" DEFAULT 'NA' FOR "nameCheck"`);

        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "country" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "location" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "name" varchar(256) NOT NULL`);

        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "dbo"."bank_data" ("name", "location") `);

        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "blockchainTx" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "message" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "direction" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "status" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "type" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "address" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "UQ_f9b1edfdf8b1f3b891780c14eaa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ALTER COLUMN "orderId" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "UQ_f9b1edfdf8b1f3b891780c14eaa" UNIQUE ("orderId")`);

        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "UQ_9c0b10ac9e8290e4f97ff402af9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ALTER COLUMN "name" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD CONSTRAINT "UQ_9c0b10ac9e8290e4f97ff402af9" UNIQUE ("name")`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "iban" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ALTER COLUMN "address" varchar(256) NOT NULL`);

        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "dbo"."sell" ("iban", "fiatId") `);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "depositAddress" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_01eddffc7b1b67b2273cba95c93"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "errorCode" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_01eddffc7b1b67b2273cba95c93" DEFAULT 'NA' FOR "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "info" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_d20cac391a081a2bef84f7216db"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "status" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_d20cac391a081a2bef84f7216db" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ALTER COLUMN "address" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_182a55f4c8516f8ef50015f6ae0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "errorCode" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_182a55f4c8516f8ef50015f6ae0" DEFAULT 'NA' FOR "errorCode"`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "info" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_3af0086da18f32ac05a52e56390"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "status" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_3af0086da18f32ac05a52e56390" DEFAULT 'Unprocessed' FOR "status"`);

        await queryRunner.query(`ALTER TABLE "dbo"."payment" ALTER COLUMN "address" varchar(256)`);

        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ALTER COLUMN "address" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc" UNIQUE ("address")`);

        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "foreignName" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "name" varchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."language" DROP CONSTRAINT "UQ_61337a8ce78f5a5d8550dbd3d58"`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ALTER COLUMN "symbol" varchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."language" ADD CONSTRAINT "UQ_61337a8ce78f5a5d8550dbd3d58" UNIQUE ("symbol")`);

        await queryRunner.query(`ALTER TABLE "dbo"."country" ALTER COLUMN "name" varchar(256) NOT NULL`);

        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "UQ_a311ea2c04056cbfb4de490d827"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ALTER COLUMN "symbol" varchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD CONSTRAINT "UQ_a311ea2c04056cbfb4de490d827" UNIQUE ("symbol")`);
    }
}
