const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MultichainDeposits1717506324942 {
    name = 'MultichainDeposits1717506324942'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit"`);
        await queryRunner.query(`DROP INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1"`);
        await queryRunner.query(`EXEC sp_rename "deposit.blockchain", "blockchains"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc" UNIQUE ("address")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8075aa7cc095dee80f82a5e710" ON "dbo"."deposit" ("accountIndex", "blockchains") WHERE accountIndex IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_8075aa7cc095dee80f82a5e710" ON "dbo"."deposit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc"`);
        await queryRunner.query(`EXEC sp_rename "deposit.blockchains", "blockchain"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1" DEFAULT 'Bitcoin' FOR "blockchain"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit" ("address", "blockchain") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit" ("accountIndex", "blockchain") WHERE ([accountIndex] IS NOT NULL)`);
    }
}
