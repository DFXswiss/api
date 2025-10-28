/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSiftErrorLog1761663196117 {
    name = 'AddSiftErrorLog1761663196117'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "sift_error_log" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_b50b158ae721ee542c254665945" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_ca7f1728726e30b3417e5eb9332" DEFAULT getdate(), "eventType" nvarchar(256) NOT NULL, "httpStatusCode" int, "errorMessage" nvarchar(MAX) NOT NULL, "duration" int NOT NULL, "isTimeout" bit NOT NULL CONSTRAINT "DF_4e064afe812416f134d7324a00c" DEFAULT 0, "requestPayload" nvarchar(MAX), "userId" int, CONSTRAINT "PK_9c8b521bd53ae99888006450d4c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "sift_error_log" ADD CONSTRAINT "FK_8d4235b26dbf610497976b06a27" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sift_error_log" DROP CONSTRAINT "FK_8d4235b26dbf610497976b06a27"`);
        await queryRunner.query(`DROP TABLE "sift_error_log"`);
    }
}
