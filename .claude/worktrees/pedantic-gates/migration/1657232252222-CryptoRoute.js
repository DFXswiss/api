const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoRoute1657232252222 {
    name = 'CryptoRoute1657232252222'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "deposit" ADD "blockchain" nvarchar(256) NOT NULL CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1" DEFAULT 'DeFiChain'`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD "assetId" int`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD "targetDepositId" int`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "annualCryptoVolume" float NOT NULL CONSTRAINT "DF_e4039037847ef4703fcf8176844" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "cryptoVolume" float NOT NULL CONSTRAINT "DF_bd7b2e74cae87fee45c2df2ac36" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "cryptoFee" float`);
        await queryRunner.query(`ALTER TABLE "user" ADD "annualCryptoVolume" float NOT NULL CONSTRAINT "DF_086a6c8e32eac3f57b1eefcaee8" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "cryptoVolume" float NOT NULL CONSTRAINT "DF_5afc530c2d37f4bd4f7eee6bd21" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_39c992b33c4680ea8ad49afb327" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_0a803db97bfc687c23d8c2001ea" FOREIGN KEY ("targetDepositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_0a803db97bfc687c23d8c2001ea"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_39c992b33c4680ea8ad49afb327"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_5afc530c2d37f4bd4f7eee6bd21"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "cryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_086a6c8e32eac3f57b1eefcaee8"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "annualCryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "cryptoFee"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_bd7b2e74cae87fee45c2df2ac36"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "cryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_e4039037847ef4703fcf8176844"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "annualCryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP COLUMN "targetDepositId"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP COLUMN "assetId"`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1"`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP COLUMN "blockchain"`);
    }
}
