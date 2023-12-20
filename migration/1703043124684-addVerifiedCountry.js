const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addVerifiedCountry1703043124684 {
    name = 'addVerifiedCountry1703043124684'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "verifiedCountryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_01cbff97f07b85e56ff246088c8" FOREIGN KEY ("verifiedCountryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_01cbff97f07b85e56ff246088c8"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "verifiedCountryId"`);
    }
}
