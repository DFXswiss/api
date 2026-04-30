const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UniqueKycHash1655213220947 {
    name = 'UniqueKycHash1655213220947'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ae1f8052958afa82055fdef34f" ON "dbo"."user_data" ("kycHash") WHERE kycHash IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_ae1f8052958afa82055fdef34f" ON "dbo"."user_data"`);
    }
}
