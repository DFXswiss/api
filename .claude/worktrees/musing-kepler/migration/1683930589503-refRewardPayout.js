const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class refRewardPayout1683930589503 {
    name = 'refRewardPayout1683930589503'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP CONSTRAINT "UQ_f5fbb5fc2683cfbd08e489f0b23"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "internalId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "targetAddress" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "targetBlockchain" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "status" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "targetBlockchain"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "targetAddress"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "internalId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD CONSTRAINT "UQ_f5fbb5fc2683cfbd08e489f0b23" UNIQUE ("internalId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward" ("txId", "userId") `);
    }
}
