module.exports = class PaymentLinkLabel1747381205530 {
    name = 'PaymentLinkLabel1747381205530'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "label" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "label"`);
    }
}
