const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankDataNameNullable1707842967880 {
    name = 'bankDataNameNullable1707842967880'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "name" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
    }
}
