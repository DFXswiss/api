const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addLogTable1669303590842 {
    name = 'addLogTable1669303590842'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "log" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a513ab9f9b19d68b2c549935834" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_78373526f54f8cfd7d9ec700513" DEFAULT getdate(), "system" nvarchar(256) NOT NULL, "subsystem" nvarchar(256) NOT NULL, "severity" nvarchar(256) NOT NULL, "message" nvarchar(MAX) NOT NULL, CONSTRAINT "PK_350604cbdf991d5930d9e618fbd" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "log"`);
    }
}
