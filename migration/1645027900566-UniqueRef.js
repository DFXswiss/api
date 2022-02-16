const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UniqueRef1645027900566 {
    name = 'UniqueRef1645027900566'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198" UNIQUE ("ref")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198"`);
    }
}
