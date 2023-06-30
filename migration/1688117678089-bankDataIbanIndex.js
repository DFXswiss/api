const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankDataIbanIndex1688117678089 {
    name = 'bankDataIbanIndex1688117678089'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data" ("iban") WHERE active = 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "iban") `);
    }
}
