/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Re-runs the RealUnit service-provider backfill (same selection and idempotent update as
 * 1782990000010-BackfillRealUnitServiceProvider) to heal the accounts onboarded between the first
 * backfill and the sign-up/sign-in marker hooks shipping: the runtime path only set the marker in
 * `registerEmail`, which existing DFX customers never reach (mail-merge early return, or the app
 * skips the email step entirely for accounts with mail + KYC level >= 10). Their RealUnit wallet
 * users survive the merge on the master account, so the wallet join below still finds them.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillRealUnitServiceProvider21784102462000 {
    name = 'BackfillRealUnitServiceProvider21784102462000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE "user_data" SET "serviceProviders" =
                CASE
                    WHEN "serviceProviders" IS NULL OR "serviceProviders" = '' THEN 'RealUnit'
                    WHEN ';' || "serviceProviders" || ';' LIKE '%;RealUnit;%' THEN "serviceProviders"
                    ELSE "serviceProviders" || ';RealUnit'
                END
            WHERE "id" IN (
                SELECT u."userDataId"
                    FROM "user" u
                    INNER JOIN "wallet" w ON w."id" = u."walletId"
                    WHERE w."name" = 'RealUnit'
                UNION
                SELECT ks."userDataId"
                    FROM "kyc_step" ks
                    WHERE ks."name" = 'RealUnitRegistration'
            )
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // No-op: the first backfill (1782990000010) already set the marker for an unknown subset of these
        // accounts, so removing it here would also strip legitimately backfilled customers.
    }
}
