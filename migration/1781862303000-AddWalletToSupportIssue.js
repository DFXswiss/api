/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddWalletToSupportIssue1781862303000 {
    name = 'AddWalletToSupportIssue1781862303000'

    /**
     * Adds the source wallet (app the ticket was opened from) to support_issue.
     * The column is NOT NULL: every creation path resolves an exact source (X-Client) or fails, so an
     * unattributed ticket cannot exist. Legacy rows predate source attribution and carry no exact signal;
     * they are backfilled to the DFX default wallet (Config.defaultWalletId = 1) as an explicit one-time
     * legacy decision - NOT as a runtime fallback.
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" ADD "walletId" integer`);
        await queryRunner.query(`UPDATE "support_issue" SET "walletId" = 1 WHERE "walletId" IS NULL`);
        await queryRunner.query(`ALTER TABLE "support_issue" ALTER COLUMN "walletId" SET NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_f5224979beab23e21df3066a60" ON "support_issue" ("walletId")`);
        await queryRunner.query(`ALTER TABLE "support_issue" ADD CONSTRAINT "FK_f5224979beab23e21df3066a60a" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" DROP CONSTRAINT "FK_f5224979beab23e21df3066a60a"`);
        await queryRunner.query(`DROP INDEX "IDX_f5224979beab23e21df3066a60"`);
        await queryRunner.query(`ALTER TABLE "support_issue" DROP COLUMN "walletId"`);
    }
}
