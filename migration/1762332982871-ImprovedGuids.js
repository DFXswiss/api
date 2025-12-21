/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ImprovedGuids1762332982871 {
    name = 'ImprovedGuids1762332982871'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_4111b4eab979dc55b675cb6e0c2"`);
        await queryRunner.query(`ALTER TABLE "user_data" ALTER COLUMN "kycHash" nvarchar(255) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data" ("kycHash")`);

        await queryRunner.query(`DROP INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge"`);
        await queryRunner.query(`ALTER TABLE "account_merge" DROP CONSTRAINT "DF_2778e4d457b743d2239a7ad3dd5"`);
        await queryRunner.query(`ALTER TABLE "account_merge" ALTER COLUMN "code" nvarchar(255) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge" ("code")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge"`);
        await queryRunner.query(`ALTER TABLE "account_merge" ALTER COLUMN "code" uniqueidentifier NOT NULL`);
        await queryRunner.query(`ALTER TABLE "account_merge" ADD CONSTRAINT "DF_2778e4d457b743d2239a7ad3dd5" DEFAULT NEWSEQUENTIALID() FOR "code"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge" ("code")`);

        await queryRunner.query(`DROP INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data"`);
        await queryRunner.query(`ALTER TABLE "user_data" ALTER COLUMN "kycHash" uniqueidentifier NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD CONSTRAINT "DF_4111b4eab979dc55b675cb6e0c2" DEFAULT NEWSEQUENTIALID() FOR "kycHash"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data" ("kycHash")`);
    }
}
