/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class TxRiskAssessment1756463340213 {
    name = 'TxRiskAssessment1756463340213'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "transaction_risk_assessment" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_63bd51b0cc23b28f539671c43cf" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_3dad9872f9e15fda375ac7a97bd" DEFAULT getdate(), "type" nvarchar(255) NOT NULL, "reason" nvarchar(MAX), "methods" nvarchar(MAX), "summary" nvarchar(MAX), "result" nvarchar(MAX), "date" datetime2, "author" nvarchar(255), "pdf" nvarchar(MAX), "status" nvarchar(255) NOT NULL CONSTRAINT "DF_e1fa7067cc7bb4654fa6aa7ca43" DEFAULT 'Created', "transactionId" int NOT NULL, CONSTRAINT "PK_e142a8f89d3b3ed291047641f37" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "transaction_risk_assessment" ADD CONSTRAINT "FK_6d1fa9287c2400bd44e7b68271a" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction_risk_assessment" DROP CONSTRAINT "FK_6d1fa9287c2400bd44e7b68271a"`);
        await queryRunner.query(`DROP TABLE "transaction_risk_assessment"`);
    }
}
