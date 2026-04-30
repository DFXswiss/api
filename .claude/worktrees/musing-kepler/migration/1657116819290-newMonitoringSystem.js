const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newMonitoringSystem1657116819290 {
    name = 'newMonitoringSystem1657116819290'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "system_state_snapshot" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_839aedba9ce54b14c8e8fc407bf" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_4adc4d9b972eb00b2135b400159" DEFAULT getdate(), "data" nvarchar(MAX) NOT NULL, CONSTRAINT "PK_f9af0ad7caf769dd2fe28acd7d1" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "system_state_snapshot"`);
    }
}
