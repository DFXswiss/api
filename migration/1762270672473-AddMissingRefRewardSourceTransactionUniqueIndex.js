/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMissingRefRewardSourceTransactionUniqueIndex1762270672473 {
    name = 'AddMissingRefRewardSourceTransactionUniqueIndex1762270672473'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_fd7af3bf3a64f48ead97fd16eb" ON "ref_reward" ("sourceTransactionId") WHERE "sourceTransactionId" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "REL_fd7af3bf3a64f48ead97fd16eb" ON "ref_reward"`);
    }
}
