/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Backfills the additive RealUnit service-provider marker for existing customers.
 * A userData is treated as a RealUnit customer if it has either
 *   (a) a user onboarded under the RealUnit wallet, or
 *   (b) a RealUnit (Aktionariat) registration KYC step.
 * These are the durable, merge-surviving provenance signals; the RealUnit wallet name on the
 * user is used only as historical backfill provenance, never as the runtime scoping anchor.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillRealUnitServiceProvider1782990000010 {
    name = 'BackfillRealUnitServiceProvider1782990000010'

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
        await queryRunner.query(`
            UPDATE "user_data"
                SET "serviceProviders" =
                    NULLIF(array_to_string(array_remove(string_to_array("serviceProviders", ';'), 'RealUnit'), ';'), '')
                WHERE ';' || "serviceProviders" || ';' LIKE '%;RealUnit;%'
        `);
    }
}
