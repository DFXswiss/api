const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class Symbol3Unique1729019908345 {
    name = 'Symbol3Unique1729019908345'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ALTER COLUMN "symbol3" nvarchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "country" ADD CONSTRAINT "UQ_72d8fffa219c1d60f6824658f46" UNIQUE ("symbol3")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "UQ_72d8fffa219c1d60f6824658f46"`);
        await queryRunner.query(`ALTER TABLE "country" ALTER COLUMN "symbol3" nvarchar(10)`);
    }
}
