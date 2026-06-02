/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds user_data.sellInitiatedDate, the marker that a user has signalled sell intent (created a
 * sell route / requested a deposit address). requiredKycSteps() uses it to surface FINANCIAL_DATA
 * for RealUnit wallets on sell intent rather than on completed sell volume, which would deadlock.
 *
 * Backfill: existing users with at least one Sell route (deposit_route.type = 'Sell') get their
 * earliest sell-route creation date, so users with a still-pending sell (sellVolume = 0) are
 * covered, not only those who already sold. Additive, nullable, idempotent (NULL-guarded).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataSellInitiatedDate1780416230591 {
    name = 'AddUserDataSellInitiatedDate1780416230591'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "sellInitiatedDate" TIMESTAMP`);

        await queryRunner.query(`
            UPDATE "user_data"
            SET "sellInitiatedDate" = sub."minCreated"
            FROM (
                SELECT u."userDataId" AS "userDataId", MIN(dr."created") AS "minCreated"
                FROM "deposit_route" dr
                JOIN "user" u ON u."id" = dr."userId"
                WHERE dr."type" = 'Sell'
                GROUP BY u."userDataId"
            ) sub
            WHERE "user_data"."id" = sub."userDataId"
              AND "user_data"."sellInitiatedDate" IS NULL
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "sellInitiatedDate"`);
    }
}
