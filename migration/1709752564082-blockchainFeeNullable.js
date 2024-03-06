const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class blockchainFeeNullable1709752564082 {
    name = 'blockchainFeeNullable1709752564082'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."blockchain_fee" ALTER COLUMN "amount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."blockchain_fee" ALTER COLUMN "amount" float NOT NULL`);
    }
}
