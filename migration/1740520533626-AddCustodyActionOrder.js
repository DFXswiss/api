const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyActionOrder1740520533626 {
    name = 'AddCustodyActionOrder1740520533626'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_action_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_23891f76140b50512faa5c57b47" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_2a57d45fb064c48bfc1279a3a64" DEFAULT getdate(), "type" nvarchar(255) NOT NULL, "status" nvarchar(255) NOT NULL CONSTRAINT "DF_faf8635c220c4fa71eedf2eb18c" DEFAULT 'Created', "userId" int NOT NULL, CONSTRAINT "PK_6376f890b7362db01f58d9a57b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressIndex" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressType" nvarchar(255)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user" ("custodyAddressIndex") WHERE custodyAddressIndex IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "custody_action_order" ADD CONSTRAINT "FK_be6219b026c0320b0556c3bf957" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "custody_action_order" DROP CONSTRAINT "FK_be6219b026c0320b0556c3bf957"`);
        await queryRunner.query(`DROP INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressType"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressIndex"`);
        await queryRunner.query(`DROP TABLE "custody_action_order"`);
    }
}
