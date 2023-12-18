const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataRelation1702657883484 {
    name = 'addUserDataRelation1702657883484'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "user_data_relation" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_7c114d731acdf975ea3bef258e6" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_2051f287b9f8bda8830f8c8d3e9" DEFAULT getdate(), "relation" nvarchar(256), "signatory" nvarchar(256), "accountId" int NOT NULL, "relatedAccountId" int NOT NULL, CONSTRAINT "PK_ff56997cdfa55669c94fde48735" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user_data_relation" ADD CONSTRAINT "FK_56f39477fa929bd1a8c93ad66d2" FOREIGN KEY ("accountId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_data_relation" ADD CONSTRAINT "FK_02a41115677a4916bb523c427d1" FOREIGN KEY ("relatedAccountId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data_relation" DROP CONSTRAINT "FK_02a41115677a4916bb523c427d1"`);
        await queryRunner.query(`ALTER TABLE "user_data_relation" DROP CONSTRAINT "FK_56f39477fa929bd1a8c93ad66d2"`);
        await queryRunner.query(`DROP TABLE "user_data_relation"`);
    }
}
