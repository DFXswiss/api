const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class uniqueTransactionUid1713863357521 {
    name = 'uniqueTransactionUid1713863357521'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ALTER COLUMN "uid" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD CONSTRAINT "UQ_7b5ae73d3d63f24cc6b32cbfd8d" UNIQUE ("uid")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP CONSTRAINT "UQ_7b5ae73d3d63f24cc6b32cbfd8d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ALTER COLUMN "uid" nvarchar(256)`);
    }
}
