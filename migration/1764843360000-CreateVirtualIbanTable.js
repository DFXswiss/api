/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class CreateVirtualIbanTable1764843360000 {
    name = 'CreateVirtualIbanTable1764843360000'

    async up(queryRunner) {
        await queryRunner.query(`
            CREATE TABLE "virtual_iban" (
                "id" int NOT NULL IDENTITY(1,1),
                "updated" datetime2 NOT NULL CONSTRAINT "DF_virtual_iban_updated" DEFAULT getdate(),
                "created" datetime2 NOT NULL CONSTRAINT "DF_virtual_iban_created" DEFAULT getdate(),
                "iban" nvarchar(34) NOT NULL,
                "bban" nvarchar(12),
                "yapealAccountUid" nvarchar(256),
                "active" bit NOT NULL CONSTRAINT "DF_virtual_iban_active" DEFAULT 1,
                "status" nvarchar(256),
                "reservedUntil" datetime2,
                "activatedAt" datetime2,
                "deactivatedAt" datetime2,
                "label" nvarchar(256),
                "currencyId" int NOT NULL,
                "userDataId" int NOT NULL,
                "bankId" int NOT NULL,
                CONSTRAINT "PK_virtual_iban" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_virtual_iban_iban" ON "virtual_iban" ("iban")`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_virtual_iban_currency" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_virtual_iban_userData" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_virtual_iban_bank" FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_virtual_iban_bank"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_virtual_iban_userData"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_virtual_iban_currency"`);
        await queryRunner.query(`DROP INDEX "IDX_virtual_iban_iban" ON "virtual_iban"`);
        await queryRunner.query(`DROP TABLE "virtual_iban"`);
    }
}
