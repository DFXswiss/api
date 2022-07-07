const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoRoute1657179767570 {
    name = 'CryptoRoute1657179767570'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "crypto_route" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_037ee81422440549ca3ee9b3170" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b7e699d7484718f3e94ebb02640" DEFAULT getdate(), "type" nvarchar(255) NOT NULL, "active" bit NOT NULL CONSTRAINT "DF_3e4a448acf22febe459f186fb6d" DEFAULT 1, "volume" float NOT NULL CONSTRAINT "DF_fd47e29d291c1d7e06ec1fe149e" DEFAULT 0, "annualVolume" float NOT NULL CONSTRAINT "DF_34e3598132fb457dccf6294b697" DEFAULT 0, "depositId" int NOT NULL, "rewardDepositId" int, "rewardAssetId" int, "paybackDepositId" int, "paybackAssetId" int, "userId" int NOT NULL, "fiatId" int, "bankAccountId" int, "assetId" int, "stakingId" int, CONSTRAINT "PK_fd91019f78d25c587f21be85e1e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "assetDepositUser" ON "crypto_route" ("assetId", "depositId", "userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_2551241f2b1ce01bc80f8d0bbe" ON "crypto_route" ("depositId") WHERE "depositId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "deposit" ADD "blockchain" nvarchar(256) NOT NULL CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1" DEFAULT 'DeFiChain'`);
        await queryRunner.query(`ALTER TABLE "user" ADD "cryptoFee" float`);
        await queryRunner.query(`ALTER TABLE "user" ADD "annualCryptoVolume" float NOT NULL CONSTRAINT "DF_086a6c8e32eac3f57b1eefcaee8" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "cryptoVolume" float NOT NULL CONSTRAINT "DF_5afc530c2d37f4bd4f7eee6bd21" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "crypto_route" ADD CONSTRAINT "FK_2551241f2b1ce01bc80f8d0bbeb" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_route" ADD CONSTRAINT "FK_1834f7e25fe6e16e3be75578b93" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_route" ADD CONSTRAINT "FK_85543603476d9e6e679dc3c495b" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_route" ADD CONSTRAINT "FK_f21959a7bc38f86056d75811571" FOREIGN KEY ("stakingId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_route" DROP CONSTRAINT "FK_f21959a7bc38f86056d75811571"`);
        await queryRunner.query(`ALTER TABLE "crypto_route" DROP CONSTRAINT "FK_85543603476d9e6e679dc3c495b"`);
        await queryRunner.query(`ALTER TABLE "crypto_route" DROP CONSTRAINT "FK_1834f7e25fe6e16e3be75578b93"`);
        await queryRunner.query(`ALTER TABLE "crypto_route" DROP CONSTRAINT "FK_2551241f2b1ce01bc80f8d0bbeb"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_5afc530c2d37f4bd4f7eee6bd21"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "cryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_086a6c8e32eac3f57b1eefcaee8"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "annualCryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "cryptoFee"`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1"`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP COLUMN "blockchain"`);
        await queryRunner.query(`DROP INDEX "REL_2551241f2b1ce01bc80f8d0bbe" ON "crypto_route"`);
        await queryRunner.query(`DROP INDEX "assetDepositUser" ON "crypto_route"`);
        await queryRunner.query(`DROP TABLE "crypto_route"`);
    }
}
