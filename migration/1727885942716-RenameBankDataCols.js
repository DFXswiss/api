const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RenameBankDataCols1727885942716 {
    name = 'RenameBankDataCols1727885942716'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.active", "approved"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.manualCheck", "manualApproved"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2357c28c5d11f7da85e15b4666" ON "dbo"."bank_data" ("iban") WHERE approved = 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_2357c28c5d11f7da85e15b4666" ON "dbo"."bank_data"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.manualApproved", "manualCheck"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.approved", "active"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data" ("iban") WHERE ([active]=(1))`);
    }
}
