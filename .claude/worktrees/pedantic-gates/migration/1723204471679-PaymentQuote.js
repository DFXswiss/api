const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentQuote1723204471679 {
    name = 'PaymentQuote1723204471679'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "payment_quote" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_005a76ade24aeeff3a1aa7f19f4" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_d560e43721c26eb98397d9ad657" DEFAULT getdate(), "uniqueId" nvarchar(256) NOT NULL, "status" nvarchar(256) NOT NULL, "transferAmounts" nvarchar(MAX) NOT NULL, "expiryDate" datetime2 NOT NULL, "paymentId" int NOT NULL, CONSTRAINT "UQ_ae67c37f9fa16497870a9cb5136" UNIQUE ("uniqueId"), CONSTRAINT "PK_bb79b03435d6a5f35eb5ab8e850" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "transferAmounts"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD CONSTRAINT "FK_8cad0a41057dc89a8565b5428cb" FOREIGN KEY ("paymentId") REFERENCES "payment_link_payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP CONSTRAINT "FK_8cad0a41057dc89a8565b5428cb"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "transferAmounts" nvarchar(MAX) NOT NULL`);
        await queryRunner.query(`DROP TABLE "payment_quote"`);
    }

}
