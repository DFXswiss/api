/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class OlkyRecipient1769899441865 {
    name = 'OlkyRecipient1769899441865'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "olky_recipient" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_3925f76f126b515c9f2e62f5ad4" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_fd6d4b7ffbc15fb2c593506cca3" DEFAULT getdate(), "iban" nvarchar(255) NOT NULL, "name" nvarchar(255) NOT NULL, "address" nvarchar(255), "zip" nvarchar(255), "city" nvarchar(255), "country" nvarchar(255), "olkyPayerId" nvarchar(255), "olkyBankAccountId" nvarchar(255), CONSTRAINT "PK_82402a9317b73394f6d09098f2d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_48aa946246025d8e5ff73a0fa8" ON "olky_recipient" ("iban", "name", "address", "zip", "city", "country") `);
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "olkyOrderId" nvarchar(255)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "olkyOrderId"`);
        await queryRunner.query(`DROP INDEX "IDX_48aa946246025d8e5ff73a0fa8" ON "olky_recipient"`);
        await queryRunner.query(`DROP TABLE "olky_recipient"`);
    }
}
