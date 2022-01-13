const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedAnnualVolume1642065684911 {
    name = 'AddedAnnualVolume1642065684911'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_c98b1d4bcfbd85d827d7efbcfde"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "minDepositAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "annualVolume" float NOT NULL CONSTRAINT "DF_bd3d7317c4454666782b18577d1" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "DF_bd3d7317c4454666782b18577d1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "annualVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "minDepositAmount" float NOT NULL CONSTRAINT "DF_c98b1d4bcfbd85d827d7efbcfde" DEFAULT 0`);
    }
}
