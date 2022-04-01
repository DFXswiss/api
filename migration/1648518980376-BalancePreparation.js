const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class BalancePreparation1648518980376 {
    name = 'BalancePreparation1648518980376'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "txType" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "isReturned" bit NOT NULL CONSTRAINT "DF_afcbfe71e7fc5bdd9000227d582" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "isPayback" bit NOT NULL CONSTRAINT "DF_49982d860173c06877a2eeb69eb" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" ADD "isReturned" bit NOT NULL CONSTRAINT "DF_ead18e6ba181b0da11882e3bed6" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" DROP CONSTRAINT "DF_ead18e6ba181b0da11882e3bed6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" DROP COLUMN "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_49982d860173c06877a2eeb69eb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "isPayback"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP CONSTRAINT "DF_afcbfe71e7fc5bdd9000227d582"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "txType"`);
    }
}
