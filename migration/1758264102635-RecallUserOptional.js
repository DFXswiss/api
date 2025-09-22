/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RecallUserOptional1758264102635 {
    name = 'RecallUserOptional1758264102635'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85"`);
        await queryRunner.query(`ALTER TABLE "recall" ALTER COLUMN "userId" int`);
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recall" DROP CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85"`);
        await queryRunner.query(`ALTER TABLE "recall" ALTER COLUMN "userId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "recall" ADD CONSTRAINT "FK_9d9db094ddf6a60b57431f39e85" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
