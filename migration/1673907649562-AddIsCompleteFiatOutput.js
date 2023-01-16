const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddIsCompleteFiatOutput1673907649562 {
    name = 'AddIsCompleteFiatOutput1673907649562'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_d7568fb14f2bd3138f69412d86c" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "batchAmount"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "batchAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "batchAmount"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "batchAmount" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP CONSTRAINT "DF_d7568fb14f2bd3138f69412d86c"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isComplete"`);
    }
}
