const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentQuote1723204471679 {
    name = 'PaymentQuote1723204471679'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "payment_link_payment_quote" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_4176eeca6470d475a1b2bd69034" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_de51fd874d17fd97a48c2e4e27b" DEFAULT getdate(), "uniqueId" nvarchar(256) NOT NULL, "status" nvarchar(256) NOT NULL, "transferAmounts" nvarchar(MAX) NOT NULL, "expiryDate" datetime2 NOT NULL, "paymentId" int NOT NULL, CONSTRAINT "UQ_116393c26daa6dafcf5fe001f66" UNIQUE ("uniqueId"), CONSTRAINT "PK_9c6200324690d48271544520a25" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "transferAmounts"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment_quote" ADD CONSTRAINT "FK_9fc91801caf53f0ca69fea88821" FOREIGN KEY ("paymentId") REFERENCES "payment_link_payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment_quote" DROP CONSTRAINT "FK_9fc91801caf53f0ca69fea88821"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "transferAmounts" nvarchar(MAX) NOT NULL`);
        await queryRunner.query(`DROP TABLE "payment_link_payment_quote"`);
    }
}
