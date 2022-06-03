const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AllowIdleMasternodes1654250762961 {
    name = 'AllowIdleMasternodes1654250762961'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP CONSTRAINT "UQ_06b6f9276103df2261c06a8c3b2"`);
        await queryRunner.query(`EXEC sp_rename "masternode.hash", "creationHash"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD "creationDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD CONSTRAINT "UQ_a45f15af84b6da70e81d03f6bb0" UNIQUE ("operator")`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD CONSTRAINT "DF_bb2493b02b73827db0946c32949" DEFAULT 0 FOR "enabled"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "creationHash" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "owner" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "timelock" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c1f5ae685b1f2b99f01e4f8f94" ON "dbo"."masternode" ("owner") WHERE owner IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6eda24f271411cb7de892b1d25" ON "dbo"."masternode" ("creationHash") WHERE creationHash IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_fc4a620d663c5774ef9c6b91c8" ON "dbo"."masternode" ("resignHash") WHERE resignHash IS NOT NULL`);
        await queryRunner.query(`UPDATE "dbo"."masternode" SET creationDate = created`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_fc4a620d663c5774ef9c6b91c8" ON "dbo"."masternode"`);
        await queryRunner.query(`DROP INDEX "IDX_6eda24f271411cb7de892b1d25" ON "dbo"."masternode"`);
        await queryRunner.query(`DROP INDEX "IDX_c1f5ae685b1f2b99f01e4f8f94" ON "dbo"."masternode"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "timelock" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "owner" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ALTER COLUMN "creationHash" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP CONSTRAINT "DF_bb2493b02b73827db0946c32949"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP CONSTRAINT "UQ_a45f15af84b6da70e81d03f6bb0"`);
        await queryRunner.query(`EXEC sp_rename "masternode.creationHash", "hash"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" DROP COLUMN "creationDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."masternode" ADD CONSTRAINT "UQ_06b6f9276103df2261c06a8c3b2" UNIQUE ("hash")`);
    }
}
