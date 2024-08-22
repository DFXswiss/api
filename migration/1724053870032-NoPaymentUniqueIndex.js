const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class NoPaymentUniqueIndex1724053870032 {
    name = 'NoPaymentUniqueIndex1724053870032'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_5c3140738a4bd749b6bdd05331" ON "payment_activation"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5c3140738a4bd749b6bdd05331" ON "payment_activation" ("method", "assetId", "amount") WHERE ([status]='Pending')`);
    }
}
