const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangedMailSendDateFormat1660920470489 {
    name = 'ChangedMailSendDateFormat1660920470489'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ADD "mailSendDate" datetime2`);
        await queryRunner.query(`UPDATE "dbo"."staking_reward" SET mailSendDate = outputDate`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "inputMailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "inputMailSendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "outputMailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "outputMailSendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "mailSendDate" datetime2`);
        await queryRunner.query(`UPDATE "dbo"."buy_crypto" SET mailSendDate = outputDate`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "mailSendDate" datetime2`);
        await queryRunner.query(`UPDATE "dbo"."ref_reward" SET mailSendDate = outputDate`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_ref_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_ref_reward" ADD "mailSendDate" datetime2`);
        await queryRunner.query(`UPDATE "dbo"."staking_ref_reward" SET mailSendDate = outputDate`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_ref_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_ref_reward" ADD "mailSendDate" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "mailSendDate" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "mailSendDate" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "outputMailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "outputMailSendDate" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "inputMailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "inputMailSendDate" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ADD "mailSendDate" float`);
    }
}
