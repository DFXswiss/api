/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Widens `user_data.tin` from varchar(256) to varchar(1024). The RealUnit multi-tax-residence
 * declaration is stored as a JSON array of {country, tin} in this column; 256 characters is no
 * longer enough from ~7 entries on (seven 11-digit TINs already serialize past 256). Widening a
 * varchar length in Postgres is a catalog-only change with no table rewrite.
 *
 * down() fails loud if longer values already exist — that is intentional (fail-closed: do not
 * silently truncate tax-residence snapshots).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class WidenUserDataTin1784000000000 {
    name = 'WidenUserDataTin1784000000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking every "user_data" write if the ALTER is
        // contended at deploy time: the timeout aborts with a clear lock_timeout error instead of
        // hanging app boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`ALTER TABLE "user_data" ALTER COLUMN "tin" TYPE character varying(1024)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Fails loud if any row already stores more than 256 characters — intentional; do not
        // silently truncate a multi-tax-residence snapshot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`ALTER TABLE "user_data" ALTER COLUMN "tin" TYPE character varying(256)`);
    }
}
