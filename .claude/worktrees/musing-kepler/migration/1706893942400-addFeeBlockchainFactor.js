const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeBlockchainFactor1706893942400 {
    name = 'addFeeBlockchainFactor1706893942400'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "blockchainFactor" float NOT NULL CONSTRAINT "DF_578f796d108afbff26b348c2b8f" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_578f796d108afbff26b348c2b8f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "blockchainFactor"`);
    }
}
