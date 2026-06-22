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
     * walletId is nullable by design: only RealUnit-app tickets (trusted X-Client header) get a positive
     * wallet; NULL means "DFX default brand". No NOT NULL / backfill - X-Client is RealUnit-only today, so
     * there is no positive DFX signal across the ecosystem to backfill against, and NULL=DFX is intentional.
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" ADD "walletId" integer`);
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
