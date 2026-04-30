const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeMaxAnnualTxVolume1707381820806 {
    name = 'addFeeMaxAnnualTxVolume1707381820806'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "maxAnnualUserTxVolume" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "annualUserTxVolumes" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "annualUserTxVolumes"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "maxAnnualUserTxVolume"`);
    }
}
