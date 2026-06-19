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
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" ADD "walletId" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_b9a1f6c3e0d24a7f8c2b5e1a3d" ON "support_issue" ("walletId")`);
        await queryRunner.query(`ALTER TABLE "support_issue" ADD CONSTRAINT "FK_b9a1f6c3e0d24a7f8c2b5e1a3d" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" DROP CONSTRAINT "FK_b9a1f6c3e0d24a7f8c2b5e1a3d"`);
        await queryRunner.query(`DROP INDEX "IDX_b9a1f6c3e0d24a7f8c2b5e1a3d"`);
        await queryRunner.query(`ALTER TABLE "support_issue" DROP COLUMN "walletId"`);
    }
}
