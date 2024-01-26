const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AccountMerge1706281445442 {
    name = 'AccountMerge1706281445442'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "account_merge" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e3b021cc65b8e459f73a3fa4c1d" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a8cb09d8fefe530f6e7c2ded177" DEFAULT getdate(), "code" uniqueidentifier NOT NULL CONSTRAINT "DF_2778e4d457b743d2239a7ad3dd5" DEFAULT NEWSEQUENTIALID(), "isCompleted" bit NOT NULL CONSTRAINT "DF_665da66edb8cea2944c9ac0421e" DEFAULT 0, "expiration" datetime2 NOT NULL, "masterId" int NOT NULL, "slaveId" int NOT NULL, CONSTRAINT "PK_859840ad6a4767e82e23ff81f77" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge" ("code") `);
        await queryRunner.query(`ALTER TABLE "account_merge" ADD CONSTRAINT "FK_8d2e2ba466e4a9812dc72a27e9c" FOREIGN KEY ("masterId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_merge" ADD CONSTRAINT "FK_978a25a7218bbdb0122b8a06683" FOREIGN KEY ("slaveId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "account_merge" DROP CONSTRAINT "FK_978a25a7218bbdb0122b8a06683"`);
        await queryRunner.query(`ALTER TABLE "account_merge" DROP CONSTRAINT "FK_8d2e2ba466e4a9812dc72a27e9c"`);
        await queryRunner.query(`DROP INDEX "IDX_2778e4d457b743d2239a7ad3dd" ON "account_merge"`);
        await queryRunner.query(`DROP TABLE "account_merge"`);
    }
}
