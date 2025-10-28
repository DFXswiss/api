/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSiftErrorLog1761311070300 {
    name = 'AddSiftErrorLog1761311070300'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "sift_error_log" ("id" int NOT NULL IDENTITY(1,1), "created" datetime2 NOT NULL CONSTRAINT "DF_sift_error_log_created" DEFAULT getdate(), "updated" datetime2 NOT NULL CONSTRAINT "DF_sift_error_log_updated" DEFAULT getdate(), "eventType" nvarchar(256) NOT NULL, "userId" int, "httpStatusCode" int, "errorMessage" nvarchar(MAX) NOT NULL, "duration" int NOT NULL, "isTimeout" bit NOT NULL CONSTRAINT "DF_sift_error_log_isTimeout" DEFAULT 0, "requestPayload" nvarchar(MAX), CONSTRAINT "PK_sift_error_log" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_sift_error_log_userId" ON "sift_error_log" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_sift_error_log_created" ON "sift_error_log" ("created") `);
        await queryRunner.query(`CREATE INDEX "IDX_sift_error_log_eventType" ON "sift_error_log" ("eventType") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_sift_error_log_eventType" ON "sift_error_log"`);
        await queryRunner.query(`DROP INDEX "IDX_sift_error_log_created" ON "sift_error_log"`);
        await queryRunner.query(`DROP INDEX "IDX_sift_error_log_userId" ON "sift_error_log"`);
        await queryRunner.query(`DROP TABLE "sift_error_log"`);
    }
}
