const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SignatureNotUnique1657277336514 {
    name = 'SignatureNotUnique1657277336514'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_b4b0b4550275499cb58bde188e0" UNIQUE ("signature")`);
    }
}
