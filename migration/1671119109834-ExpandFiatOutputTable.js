const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ExpandFiatOutputTable1671119109834 {
    name = 'ExpandFiatOutputTable1671119109834'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "originEntityId" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "accountIban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "batchId" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "batchAmount" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "charge" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isInstant" bit NOT NULL CONSTRAINT "DF_32fa158879099c0120d0b2d25f5" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "valutaDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "currency" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "amount" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "remittanceInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "accountNumber" int`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "name" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "address" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "zip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "city" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "country" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "iban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "aba" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "bic" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "creditInstitution" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "pmtInfId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "instrId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "endToEndId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isReadyDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isTransmittedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isConfirmedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "isApprovedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "info" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "outputDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "bankTxId" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "bankTxId"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "outputDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "info"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isApprovedDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isConfirmedDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isTransmittedDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isReadyDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "endToEndId"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "instrId"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "pmtInfId"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "creditInstitution"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "bic"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "aba"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "iban"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "country"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "city"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "zip"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "address"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "accountNumber"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "remittanceInfo"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "currency"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "valutaDate"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP CONSTRAINT "DF_32fa158879099c0120d0b2d25f5"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "isInstant"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "charge"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "batchAmount"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "batchId"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "accountIban"`);
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "originEntityId"`);
        await queryRunner.query(`ALTER TABLE "bank" ADD "sctInst" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank" ADD CONSTRAINT "DF_4a2bcad5d01e25259e297a79f83" DEFAULT 0 FOR "sctInst"`);
    }
}
