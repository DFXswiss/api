const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class extendBicLength1656546677836 {
    name = 'extendBicLength1656546677836'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "bic" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "allBicCandidates" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "allBicCandidates" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "bic" nvarchar(256)`);
    }
}
