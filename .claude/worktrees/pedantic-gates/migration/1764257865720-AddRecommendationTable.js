/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRecommendationTable1764257865720 {
    name = 'AddRecommendationTable1764257865720'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "recommendation" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_971793879369efd944832d1e378" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a599c1b336af3c6e18ad3ea0ea2" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "creator" nvarchar(256) NOT NULL, "code" nvarchar(256) NOT NULL, "recommendedAlias" nvarchar(256) NOT NULL, "recommendedMail" nvarchar(256), "isConfirmed" bit, "expirationDate" datetime2 NOT NULL, "confirmationDate" datetime2, "recommenderId" int NOT NULL, "recommendedId" int, "kycStepId" int, CONSTRAINT "UQ_507d6f3b23a6c23ba15bcf51902" UNIQUE ("code"), CONSTRAINT "PK_17cb51984a6627ef2ce7370e23c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_fd4e956adea2106cadaa7c1299" ON "recommendation" ("kycStepId") WHERE "kycStepId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "autoTradeApproval" bit NOT NULL CONSTRAINT "DF_aaf43acc1f081777d8fbe820eb8" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "recommendation" ADD CONSTRAINT "FK_b26c58cd335e7911fa7935a6f1b" FOREIGN KEY ("recommenderId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recommendation" ADD CONSTRAINT "FK_9e74ac8f02e38e78907e79ba01d" FOREIGN KEY ("recommendedId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recommendation" ADD CONSTRAINT "FK_fd4e956adea2106cadaa7c12992" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recommendation" DROP CONSTRAINT "FK_fd4e956adea2106cadaa7c12992"`);
        await queryRunner.query(`ALTER TABLE "recommendation" DROP CONSTRAINT "FK_9e74ac8f02e38e78907e79ba01d"`);
        await queryRunner.query(`ALTER TABLE "recommendation" DROP CONSTRAINT "FK_b26c58cd335e7911fa7935a6f1b"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_aaf43acc1f081777d8fbe820eb8"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "autoTradeApproval"`);
        await queryRunner.query(`DROP INDEX "REL_fd4e956adea2106cadaa7c1299" ON "recommendation"`);
        await queryRunner.query(`DROP TABLE "recommendation"`);
    }
}
