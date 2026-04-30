const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBlackSquadMail1679009222552 {
    name = 'addBlackSquadMail1679009222552'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "blackSquadRecipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "blackSquadMailSendDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "blackSquadMailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "blackSquadRecipientMail"`);
    }
}
