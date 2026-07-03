/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Partial index supporting the open referral-credit liability aggregate read by the financial log
 * every minute (UserService.getOpenRefCreditEur). The predicate matches the query filter so only the
 * few users with an open balance are scanned instead of the whole user table.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserOpenRefCreditIndex1782385841932 {
    name = 'AddUserOpenRefCreditIndex1782385841932';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "IDX_user_open_ref_credit" ON "user" ("userDataId") WHERE ("partnerRefCredit" + "refCredit" - "paidRefCredit") > 0`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_user_open_ref_credit"`);
    }
};
