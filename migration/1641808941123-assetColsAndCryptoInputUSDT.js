const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class assetColsAndCryptoInputUSDT1641808941123 {
    name = 'assetColsAndCryptoInputUSDT1641808941123'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "minDepositAmount" float NOT NULL CONSTRAINT "DF_c98b1d4bcfbd85d827d7efbcfde" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "isLP" bit NOT NULL CONSTRAINT "DF_e424b7ab482d5938d5f85c2001c" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "sellCommand" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "dexName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "usdtAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "chainId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "UQ_73cbdeb6eea93ce3d67eeaed655"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "UQ_73cbdeb6eea93ce3d67eeaed655" UNIQUE ("chainId")`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "chainId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "usdtAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "dexName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "sellCommand"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_e424b7ab482d5938d5f85c2001c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "isLP"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_c98b1d4bcfbd85d827d7efbcfde"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "minDepositAmount"`);
    }
}
