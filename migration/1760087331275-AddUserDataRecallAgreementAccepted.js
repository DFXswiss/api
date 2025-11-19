/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataRecallAgreementAccepted1760087331275 {
    name = 'AddUserDataRecallAgreementAccepted1760087331275'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "recallAgreementAccepted" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "recallAgreementAccepted"`);
    }
}
