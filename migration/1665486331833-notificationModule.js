const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class notificationModule1665486331833 {
    name = 'notificationModule1665486331833'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "notification" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e3d9266f1a6d4cf00832ae607c3" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_af7e45ec51e6aff202fbb030ecd" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "context" nvarchar(256) NOT NULL, "correlationId" nvarchar(MAX) NOT NULL, "sendDate" datetime2 NOT NULL, "suppressRecurring" bit NOT NULL CONSTRAINT "DF_830adad2aae5ed9e956909141fb" DEFAULT 0, "debounce" float, CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "notification"`);
    }
}
