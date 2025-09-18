/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RecallUserOptional1756201286864 {
    name = 'RecallUserOptional1756201286864'

    async up(queryRunner) {
        // Drop the foreign key constraint first
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85"`);

        // Make userId column nullable in SQL Server
        await queryRunner.query(`ALTER TABLE "recall" ALTER COLUMN "userId" int NULL`);

        // Re-add the foreign key constraint with the column now nullable
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        // Drop the foreign key constraint
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85"`);

        // Make userId column NOT NULL again
        await queryRunner.query(`ALTER TABLE "recall" ALTER COLUMN "userId" int NOT NULL`);

        // Re-add the foreign key constraint with NOT NULL
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}