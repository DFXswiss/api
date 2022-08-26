const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAccountIban1661503172999 {
    name = 'AddAccountIban1661503172999'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "accountIban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP CONSTRAINT "FK_feb41dc8ee54a46b69833ed05b2"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "txInfo"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "txInfo" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ALTER COLUMN "batchId" int`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD CONSTRAINT "FK_feb41dc8ee54a46b69833ed05b2" FOREIGN KEY ("batchId") REFERENCES "bank_tx_batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP CONSTRAINT "FK_feb41dc8ee54a46b69833ed05b2"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ALTER COLUMN "batchId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "txInfo"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "txInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD CONSTRAINT "FK_feb41dc8ee54a46b69833ed05b2" FOREIGN KEY ("batchId") REFERENCES "bank_tx_batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "accountIban"`);
    }
}
