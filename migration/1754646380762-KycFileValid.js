/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class KycFileValid1754646380762 {
    name = 'KycFileValid1754646380762'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD "valid" bit NOT NULL CONSTRAINT "DF_27c8d4f682c9dcd19c9c1721a74" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP CONSTRAINT "DF_27c8d4f682c9dcd19c9c1721a74"`);
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP COLUMN "valid"`);
    }
}
