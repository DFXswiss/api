/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankTxRepeatUser1762507571716 {
    name = 'AddBankTxRepeatUser1762507571716'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD CONSTRAINT "FK_272fc6a981d6fde60688bc4a643" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP CONSTRAINT "FK_272fc6a981d6fde60688bc4a643"`);
    }
}
