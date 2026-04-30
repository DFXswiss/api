const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class changeBankTxRepeatUserCol1669051731231 {
    name = 'changeBankTxRepeatUserCol1669051731231'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP CONSTRAINT "FK_272fc6a981d6fde60688bc4a643"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD CONSTRAINT "FK_272fc6a981d6fde60688bc4a643" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
