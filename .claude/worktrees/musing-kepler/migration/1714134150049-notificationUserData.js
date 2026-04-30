const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class notificationUserData1714134150049 {
    name = 'notificationUserData1714134150049'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD CONSTRAINT "FK_68a9597d61ec49bff1b41daaeeb" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "FK_68a9597d61ec49bff1b41daaeeb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP COLUMN "userDataId"`);
    }
}
