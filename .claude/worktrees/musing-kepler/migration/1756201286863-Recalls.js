/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class Recalls1756201286863 {
    name = 'Recalls1756201286863'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "recall" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_f38cf9513d96b9f97b81a6765a3" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_42e6a26ed3ac378a844ae6a176a" DEFAULT getdate(), "sequence" int NOT NULL, "comment" nvarchar(MAX) NOT NULL, "fee" float NOT NULL, "bankTxId" int, "checkoutTxId" int, "userId" int NOT NULL, CONSTRAINT "PK_93db2feecc1f9bbf8c9fdd6d744" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9d86c5e7ecc6398ba02c0646f1" ON "recall" ("bankTxId", "checkoutTxId", "sequence") `);
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_31c84229965f595a7e64557f0c9" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_12996e79d6611144548c364d5bc" FOREIGN KEY ("checkoutTxId") REFERENCES "checkout_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85"`);
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_12996e79d6611144548c364d5bc"`);
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_31c84229965f595a7e64557f0c9"`);
        await queryRunner.query(`DROP INDEX "IDX_9d86c5e7ecc6398ba02c0646f1" ON "recall"`);
        await queryRunner.query(`DROP TABLE "recall"`);
    }
}
