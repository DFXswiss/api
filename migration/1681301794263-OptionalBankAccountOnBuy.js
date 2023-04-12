const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class OptionalBankAccountOnBuy1681301794263 {
  name = 'OptionalBankAccountOnBuy1681301794263';

  async up(queryRunner) {
    await queryRunner.query(`DROP INDEX "ibanAssetDepositUser" ON "dbo"."buy"`);
    await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
    await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "iban" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankAccountId" int`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5555a31168851f18ea1404f631" ON "dbo"."buy" ("iban", "assetId", "depositId", "userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
    await queryRunner.query(`DROP INDEX "IDX_5555a31168851f18ea1404f631" ON "dbo"."buy"`);
    await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankAccountId" int NOT NULL`);
    await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "iban" nvarchar(256) NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ibanAssetDepositUser" ON "dbo"."buy" ("iban", "assetId", "depositId", "userId") `,
    );
  }
};
