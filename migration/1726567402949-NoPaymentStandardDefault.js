const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class NoPaymentStandardDefault1726567402949 {
    name = 'NoPaymentStandardDefault1726567402949'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP CONSTRAINT "DF_09b2f8c6e412cbdaaa9ac704ce1"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "DF_ee2feac2b789df65501547338b5"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD CONSTRAINT "DF_ee2feac2b789df65501547338b5" DEFAULT 'OpenCryptoPay' FOR "standard"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD CONSTRAINT "DF_09b2f8c6e412cbdaaa9ac704ce1" DEFAULT 'OpenCryptoPay' FOR "standard"`);
    }
}
