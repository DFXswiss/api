const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserBlockchain1671280095273 {
    name = 'addUserBlockchain1671280095273'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "blockchain" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_3122b4b8709577da50e89b68983"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f1edfa49d4352a975814ea13a1" ON "dbo"."user" ("address", "blockchain") `);
        await queryRunner.query(`ALTER TABLE "dbo"."link_address" ADD "existingBlockchain" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."link_address" ADD "newBlockchain" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_f1edfa49d4352a975814ea13a1" ON "dbo"."user"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_3122b4b8709577da50e89b68983" UNIQUE ("address")`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "blockchain"`);
        await queryRunner.query(`ALTER TABLE "dbo"."link_address" DROP COLUMN "newBlockchain"`);
        await queryRunner.query(`ALTER TABLE "dbo"."link_address" DROP COLUMN "existingBlockchain"`);
    }
}
