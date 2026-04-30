/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class VirtualIban1764928574215 {
    name = 'VirtualIban1764928574215'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "virtual_iban" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_03832d4b7e51a403dc883637ecb" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_72f6c2623c4c73e845682f24557" DEFAULT getdate(), "iban" nvarchar(34) NOT NULL, "bban" nvarchar(12), "yapealAccountUid" nvarchar(256), "active" bit NOT NULL CONSTRAINT "DF_e10ecd295781c39a5f84cf18dac" DEFAULT 1, "status" nvarchar(256), "reservedUntil" datetime2, "activatedAt" datetime2, "deactivatedAt" datetime2, "label" nvarchar(256), "currencyId" int NOT NULL, "userDataId" int NOT NULL, "bankId" int NOT NULL, CONSTRAINT "UQ_e4f722ba8c3e8b20d97f1cb9af8" UNIQUE ("iban"), CONSTRAINT "PK_5bcf7d8200aa0e03e0c8056d0b9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_3c6b96df57028f34f8634f839a1" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_120a2739b632dc95c854f6b947f" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_708b5ca3b87711bf3052dd39ce9" FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_708b5ca3b87711bf3052dd39ce9"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_120a2739b632dc95c854f6b947f"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_3c6b96df57028f34f8634f839a1"`);
        await queryRunner.query(`DROP TABLE "virtual_iban"`);
    }
}
