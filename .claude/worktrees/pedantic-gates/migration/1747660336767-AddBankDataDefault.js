module.exports = class AddBankDataDefault1747660336767 {
    name = 'AddBankDataDefault1747660336767'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_data" ADD "default" bit NOT NULL CONSTRAINT "DF_d9b24ec80fc9d89dd9a25c2b0a6" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_data" DROP CONSTRAINT "DF_d9b24ec80fc9d89dd9a25c2b0a6"`);
        await queryRunner.query(`ALTER TABLE "bank_data" DROP COLUMN "default"`);
    }
}
