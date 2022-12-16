const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserBlockchain1671196783683 {
    name = 'addUserBlockchain1671196783683'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "blockchain" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_3122b4b8709577da50e89b68983"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "blockchainAddress" ON "dbo"."user" ("address", "blockchain") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "blockchainAddress" ON "dbo"."user"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_3122b4b8709577da50e89b68983" UNIQUE ("address")`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "blockchain"`);
    }
}
