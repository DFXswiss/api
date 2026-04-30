const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class AddedCheckoutTx1696423782974 {
  name = 'AddedCheckoutTx1696423782974';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "checkout_tx" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a56bdea65945d2db9ef718e0736" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8b85380dbceb429dbc7502fdb79" DEFAULT getdate(), "paymentId" nvarchar(255) NOT NULL, "requestedOn" datetime2 NOT NULL, "expiresOn" datetime2 NOT NULL, "amount" float NOT NULL, "currency" nvarchar(255) NOT NULL, "status" nvarchar(255) NOT NULL, "approved" bit NOT NULL, "reference" nvarchar(255), "description" nvarchar(255), "type" nvarchar(255), "cardName" nvarchar(255), "cardFingerPrint" nvarchar(255), "ip" nvarchar(255), "risk" bit, "riskScore" int, "raw" nvarchar(MAX) NOT NULL, CONSTRAINT "UQ_2841f27af666ca5354f58ae65a4" UNIQUE ("paymentId"), CONSTRAINT "PK_eabd7e30dfbc28e0686048bbe40" PRIMARY KEY ("id"))`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP TABLE "checkout_tx"`);
  }
};
