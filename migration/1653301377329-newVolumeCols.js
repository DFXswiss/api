const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newVolumeCols1653301377329 {
    name = 'newVolumeCols1653301377329'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "annualVolume" float CONSTRAINT "DF_0a00ff47ac37d9d88d15030bb4f" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "annualBuyVolume" float NOT NULL CONSTRAINT "DF_4cb8d773f22b8ed56a8cd35c372" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "buyVolume" float NOT NULL CONSTRAINT "DF_c1f7549d82795b3badf63b225eb" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "annualSellVolume" float NOT NULL CONSTRAINT "DF_8b6813d1155b97ac841d2d19c2e" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "sellVolume" float NOT NULL CONSTRAINT "DF_d32d207f7f8f821ef166fabf97f" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "stakingBalance" float NOT NULL CONSTRAINT "DF_99edc23c9dede314ed8d03815df" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "annualBuyVolume" float NOT NULL CONSTRAINT "DF_08568e41a26702e08021d243511" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "buyVolume" float NOT NULL CONSTRAINT "DF_a95f860c8fbca31ebd2284a518c" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "annualSellVolume" float NOT NULL CONSTRAINT "DF_c75313b69ca5bef431ab5aea20d" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "sellVolume" float NOT NULL CONSTRAINT "DF_f51b0b346011e3d5e03c6b83434" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingBalance" float NOT NULL CONSTRAINT "DF_8a0099ab4d2a1d37e5da12ab4cc" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ALTER COLUMN "volume" float NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ALTER COLUMN "volume" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_8a0099ab4d2a1d37e5da12ab4cc"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingBalance"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_f51b0b346011e3d5e03c6b83434"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "sellVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_c75313b69ca5bef431ab5aea20d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "annualSellVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_a95f860c8fbca31ebd2284a518c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "buyVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_08568e41a26702e08021d243511"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "annualBuyVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_99edc23c9dede314ed8d03815df"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "stakingBalance"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_d32d207f7f8f821ef166fabf97f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "sellVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_8b6813d1155b97ac841d2d19c2e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "annualSellVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_c1f7549d82795b3badf63b225eb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "buyVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_4cb8d773f22b8ed56a8cd35c372"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "annualBuyVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "DF_0a00ff47ac37d9d88d15030bb4f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "annualVolume"`);
    }
}
