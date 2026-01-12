/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRefRewardSourceTransaction1761311070246 {
    name = 'AddRefRewardSourceTransaction1761311070246'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD "sourceTransactionId" int`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_fd7af3bf3a64f48ead97fd16eb6" FOREIGN KEY ("sourceTransactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_fd7af3bf3a64f48ead97fd16eb6"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP COLUMN "sourceTransactionId"`);
    }
}
