/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFiatOutputBank1766395658412 {
    name = 'AddFiatOutputBank1766395658412'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "bankId" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD CONSTRAINT "FK_fa54ae64810205dad7e8fee3ea9" FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP CONSTRAINT "FK_fa54ae64810205dad7e8fee3ea9"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "bankId"`);
    }
}
