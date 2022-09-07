const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeAssetNameUnique1662544933802 {
    name = 'removeAssetNameUnique1662544933802'

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_0e1dda4bf7f110acc1b1988dc81"`);
    }
}
