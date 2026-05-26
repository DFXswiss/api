/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixNullableUniqueIndexes1779812989037 {
    name = 'FixNullableUniqueIndexes1779812989037'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // kyc_step: recreate unique index with NULLS NOT DISTINCT so NULL type is treated as equal
        await queryRunner.query(`DROP INDEX "IDX_3a1150791476264753a67212a1"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3a1150791476264753a67212a1" ON "kyc_step" ("userDataId", "name", "type", "sequenceNumber") NULLS NOT DISTINCT`);

        // user_data: add nationalityId IS NOT NULL to WHERE clause
        await queryRunner.query(`DROP INDEX "IDX_99da8fce0c522a35d93b9499f4"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_99da8fce0c522a35d93b9499f4" ON "user_data" ("identDocumentId", "nationalityId", "accountType", "kycType") WHERE "identDocumentId" IS NOT NULL AND "accountType" IS NOT NULL AND "kycType" IS NOT NULL AND "nationalityId" IS NOT NULL`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_99da8fce0c522a35d93b9499f4"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_99da8fce0c522a35d93b9499f4" ON "user_data" ("identDocumentId", "nationalityId", "accountType", "kycType") WHERE "identDocumentId" IS NOT NULL AND "accountType" IS NOT NULL AND "kycType" IS NOT NULL`);

        await queryRunner.query(`DROP INDEX "IDX_3a1150791476264753a67212a1"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3a1150791476264753a67212a1" ON "kyc_step" ("userDataId", "name", "type", "sequenceNumber")`);
    }
}
