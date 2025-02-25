const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyFields1740503762512 {
    name = 'AddCustodyFields1740503762512'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressIndex" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressType" nvarchar(255)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user" ("custodyAddressIndex") WHERE custodyAddressIndex IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressType"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressIndex"`);
    }
}
