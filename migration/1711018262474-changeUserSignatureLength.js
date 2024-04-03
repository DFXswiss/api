const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class changeUserSignatureLength1711018262474 {
    name = 'changeUserSignatureLength1711018262474'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(700)`);
    }
}
