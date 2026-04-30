const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ActivationStatusRename1725958684942 {
    name = 'ActivationStatusRename1725958684942'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_175c17fcf3544d29a07f75b51b" ON "payment_activation"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0a81ffa8588208691341c49ead" ON "payment_activation" ("method", "assetId", "amount") WHERE status = 'Open' AND standard = 'PayToAddress'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_0a81ffa8588208691341c49ead" ON "payment_activation"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_175c17fcf3544d29a07f75b51b" ON "payment_activation" ("method", "assetId", "amount") WHERE ([status]='Pending' AND [standard]='PayToAddress')`);
    }
}
