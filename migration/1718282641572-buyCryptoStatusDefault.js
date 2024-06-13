const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyCryptoStatusDefault1718282641572 {
    name = 'buyCryptoStatusDefault1718282641572'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "DF_d5c231478ed12f258caacfa4b9d" DEFAULT 'Created' FOR "status"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "DF_d5c231478ed12f258caacfa4b9d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "status" nvarchar(256)`);
    }
}
