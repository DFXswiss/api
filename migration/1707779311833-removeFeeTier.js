const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeFeeTier1707779311833 {
    name = 'removeFeeTier1707779311833'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_8d629c2b9f20a857316a1ccf19b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "feeTier"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "feeTier" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "DF_8d629c2b9f20a857316a1ccf19b" DEFAULT 'Tier2' FOR "feeTier"`);
    }
}
