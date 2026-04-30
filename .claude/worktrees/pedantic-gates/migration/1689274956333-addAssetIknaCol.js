const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAssetIknaCol1689274956333 {
    name = 'addAssetIknaCol1689274956333'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "ikna" bit NOT NULL CONSTRAINT "DF_cfec2aac7dae0eb8cefb8aedfff" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_cfec2aac7dae0eb8cefb8aedfff"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "ikna"`);
    }
}
