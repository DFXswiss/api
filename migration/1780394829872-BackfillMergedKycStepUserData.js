/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Data backfill for #3800: re-parent KYC steps that were left behind on now-merged (slave)
 * accounts onto their surviving master. The code fix only covers future merges; rows from past
 * merges still have userDataId = <merged-away account>. user_data has no master FK, so the
 * authoritative slave -> master mapping is the set of completed account_merge rows.
 *
 * Looped to resolve chained merges (A -> B -> C); idempotent (a no-op once converged). Slave step
 * sequence numbers were already shifted below the master's during the original merge, so moving the
 * FK does not collide with the [userData, name, type, sequenceNumber] unique index.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillMergedKycStepUserData1780394829872 {
    name = 'BackfillMergedKycStepUserData1780394829872'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        let guard = 0;
        let remaining = 0;

        do {
            await queryRunner.query(`
                UPDATE "kyc_step"
                SET "userDataId" = am."masterId"
                FROM "account_merge" am
                WHERE am."slaveId" = "kyc_step"."userDataId"
                  AND am."isCompleted" = true
            `);

            const [{ count }] = await queryRunner.query(`
                SELECT COUNT(*)::int AS count
                FROM "kyc_step" ks
                JOIN "account_merge" am ON am."slaveId" = ks."userDataId" AND am."isCompleted" = true
            `);
            remaining = count;
        } while (remaining > 0 && ++guard < 50);
    }

    /**
     * Data backfill — the original per-step ownership is not recoverable, so down is a no-op.
     */
    async down() {
        // intentionally empty
    }
}
