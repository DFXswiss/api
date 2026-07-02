/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Backs the app-level kycFileId uniqueness check (UserDataService.updateUserDataInternal) with a real
 * constraint - that check is a read-then-write race between concurrent AML postProcessing calls.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataKycFileIdUniqueIndex1782911659474 {
    name = 'AddUserDataKycFileIdUniqueIndex1782911659474';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8dae6f6af0a6b5dc2ec16c333c" ON "user_data" ("kycFileId") WHERE "kycFileId" IS NOT NULL`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_8dae6f6af0a6b5dc2ec16c333c"`);
    }
};
