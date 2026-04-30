/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LmActivationDelay1756915483455 {
    name = 'LmActivationDelay1756915483455'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD "delayActivation" bit NOT NULL CONSTRAINT "DF_a7efba629590f8cba09c0da1d79" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "DF_a7efba629590f8cba09c0da1d79"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP COLUMN "delayActivation"`);
    }
}
