/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCustodyAccountTables1768338479982 {
    name = 'AddCustodyAccountTables1768338479982'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_account_access" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_7de1867f044392358470c9ade75" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8b3a56557a24d8c9157c4867435" DEFAULT getdate(), "accessLevel" nvarchar(255) NOT NULL, "custodyAccountId" int NOT NULL, "userDataId" int NOT NULL, CONSTRAINT "PK_1657b7fd1d5a0ee0b01f657e508" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8a2ec36ebff5b786fd4d7e0142" ON "custody_account_access" ("custodyAccountId", "userDataId") `);
        await queryRunner.query(`CREATE TABLE "custody_account" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_91a0617046b1f9ca14218362617" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_281789479a65769e9189e24f7d9" DEFAULT getdate(), "title" nvarchar(256) NOT NULL, "description" nvarchar(MAX), "requiredSignatures" int NOT NULL CONSTRAINT "DF_980d2b28fe8284b5060c70a36fd" DEFAULT 1, "status" nvarchar(255) NOT NULL CONSTRAINT "DF_aaeefb3ab36f3b7e02b5f4c67fc" DEFAULT 'Active', "ownerId" int NOT NULL, CONSTRAINT "PK_89fae3a990abaa76d843242fc6d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD "custodyAccountId" int`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD "initiatedById" int`);
        await queryRunner.query(`ALTER TABLE "custody_balance" ADD "custodyAccountId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAccountId" int`);
        await queryRunner.query(`ALTER TABLE "custody_account_access" ADD CONSTRAINT "FK_c678151aaee25061ce6ce5ba2f5" FOREIGN KEY ("custodyAccountId") REFERENCES "custody_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_account_access" ADD CONSTRAINT "FK_8a4612269b283bf40950ddb8485" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_account" ADD CONSTRAINT "FK_b89a7cbab6c121f5a092815fce3" FOREIGN KEY ("ownerId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD CONSTRAINT "FK_e6a0e5cbc91e9bdca945101c67f" FOREIGN KEY ("custodyAccountId") REFERENCES "custody_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD CONSTRAINT "FK_67425e623d89efe4ae1a48dbad6" FOREIGN KEY ("initiatedById") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_balance" ADD CONSTRAINT "FK_9cd8ac552741c57822426335f70" FOREIGN KEY ("custodyAccountId") REFERENCES "custody_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_bf8ce326ec41adc02940bccf91a" FOREIGN KEY ("custodyAccountId") REFERENCES "custody_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_bf8ce326ec41adc02940bccf91a"`);
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP CONSTRAINT "FK_9cd8ac552741c57822426335f70"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_67425e623d89efe4ae1a48dbad6"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_e6a0e5cbc91e9bdca945101c67f"`);
        await queryRunner.query(`ALTER TABLE "custody_account" DROP CONSTRAINT "FK_b89a7cbab6c121f5a092815fce3"`);
        await queryRunner.query(`ALTER TABLE "custody_account_access" DROP CONSTRAINT "FK_8a4612269b283bf40950ddb8485"`);
        await queryRunner.query(`ALTER TABLE "custody_account_access" DROP CONSTRAINT "FK_c678151aaee25061ce6ce5ba2f5"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAccountId"`);
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP COLUMN "custodyAccountId"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP COLUMN "initiatedById"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP COLUMN "custodyAccountId"`);
        await queryRunner.query(`DROP TABLE "custody_account"`);
        await queryRunner.query(`DROP INDEX "IDX_8a2ec36ebff5b786fd4d7e0142" ON "custody_account_access"`);
        await queryRunner.query(`DROP TABLE "custody_account_access"`);
    }
}
