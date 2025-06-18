const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCountryAmlRule1748259486840 {
    name = 'AddCountryAmlRule1748259486840'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "amlRule" int NOT NULL CONSTRAINT "DF_f6c5805e908317b6cd6ae0ebad8" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_f6c5805e908317b6cd6ae0ebad8"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "amlRule"`);
    }
}
