const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newCountryEnableCol1668697486667 {
    name = 'newCountryEnableCol1668697486667'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "lockEnable" bit NOT NULL CONSTRAINT "DF_6961269228c96b408fb178b3a6c" DEFAULT 1`);
        await queryRunner.query(`EXEC sp_rename "country.enable", "dfxEnable"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_6961269228c96b408fb178b3a6c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "lockEnable"`);
        await queryRunner.query(`EXEC sp_rename "country.dfxEnable", "enable"`);
    }
}
