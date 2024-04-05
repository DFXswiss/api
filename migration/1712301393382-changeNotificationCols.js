const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class changeNotificationCols1712301393382 {
    name = 'changeNotificationCols1712301393382'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "DF_86811aa9bf0da72645b2c9f4958"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "DF_ff524eec27966c9c963ab1ab896"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD CONSTRAINT "DF_ff524eec27966c9c963ab1ab896" DEFAULT 0 FOR "isComplete"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "DF_ff524eec27966c9c963ab1ab896"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD CONSTRAINT "DF_ff524eec27966c9c963ab1ab896" DEFAULT 1 FOR "isComplete"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD CONSTRAINT "DF_86811aa9bf0da72645b2c9f4958" DEFAULT '-' FOR "data"`);
    }
}
