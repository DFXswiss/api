const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFatfEnable1699717429095 {
    name = 'addFatfEnable1699717429095'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "fatfEnable" bit NOT NULL CONSTRAINT "DF_6ce6bb372ab0dc5d1b1c2f7863f" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_6ce6bb372ab0dc5d1b1c2f7863f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "fatfEnable"`);
    }
}
