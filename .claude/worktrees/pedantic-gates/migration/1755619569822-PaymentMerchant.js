/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PaymentMerchant1755619569822 {
    name = 'PaymentMerchant1755619569822'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "payment_merchant" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_2ab8754ac3ed31b9d17c4d9ac2e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a9cf1b698aa8cdb80cff9e2fe33" DEFAULT getdate(), "externalId" nvarchar(256) NOT NULL, "status" nvarchar(256) NOT NULL, "data" nvarchar(MAX) NOT NULL, "userId" int NOT NULL, CONSTRAINT "PK_0fa45009ec3860d5d13f3cdd530" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "payment_merchant" ADD CONSTRAINT "FK_980c76801f97ea9f89f0593cbe1" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_merchant" DROP CONSTRAINT "FK_980c76801f97ea9f89f0593cbe1"`);
        await queryRunner.query(`DROP TABLE "payment_merchant"`);
    }
}
