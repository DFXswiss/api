const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSymbol3Country1726842615437 {
    name = 'AddSymbol3Country1726842615437'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "symbol3" nvarchar(255) NOT NULL CONSTRAINT "DF_72d8fffa219c1d60f6824658f46" DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "country" ADD CONSTRAINT "DF_2c5aa339240c0c3ae97fcc9dc4c" DEFAULT '' FOR "name"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_2c5aa339240c0c3ae97fcc9dc4c"`);
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_72d8fffa219c1d60f6824658f46"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "symbol3"`);
    }
}
