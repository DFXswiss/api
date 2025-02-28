const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyOrderStep1740757860019 {
    name = 'AddCustodyOrderStep1740757860019'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_order_step" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_ea57411e48c562b719b149f61f1" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_30b5b667788d4be46adbd280ac0" DEFAULT getdate(), "status" nvarchar(255) NOT NULL CONSTRAINT "DF_ee10b470ef191c7b8dec7de15e6" DEFAULT 'Created', "correlationId" nvarchar(255), "index" int NOT NULL, "command" nvarchar(255) NOT NULL, "context" nvarchar(255) NOT NULL, "orderId" int NOT NULL, CONSTRAINT "PK_0c02700136cb6f0a2877a0846e2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "custody_order_step" ADD CONSTRAINT "FK_87abfc63585017ae9e65629c843" FOREIGN KEY ("orderId") REFERENCES "custody_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "custody_order_step" DROP CONSTRAINT "FK_87abfc63585017ae9e65629c843"`);
        await queryRunner.query(`DROP TABLE "custody_order_step"`);
    }
}
