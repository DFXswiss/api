const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addNotificationCols1712159051309 {
    name = 'addNotificationCols1712159051309'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "notification.sendDate", "lastTryDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD "data" nvarchar(MAX) NOT NULL CONSTRAINT "DF_86811aa9bf0da72645b2c9f4958" DEFAULT '-'`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_ff524eec27966c9c963ab1ab896" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ADD "error" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ALTER COLUMN "correlationId" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."notification" ALTER COLUMN "correlationId" nvarchar(MAX) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP COLUMN "error"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "DF_ff524eec27966c9c963ab1ab896"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP COLUMN "isComplete"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP CONSTRAINT "DF_86811aa9bf0da72645b2c9f4958"`);
        await queryRunner.query(`ALTER TABLE "dbo"."notification" DROP COLUMN "data"`);
        await queryRunner.query(`EXEC sp_rename "notification.lastTryDate", "sendDate"`);
    }
}
