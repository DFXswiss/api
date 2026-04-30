const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveDfiToken1666088375171 {
    name = 'RemoveDfiToken1666088375171'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameBlockchain" ON "dbo"."asset"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameTypeBlockchain" ON "dbo"."asset" ("name", "type", "blockchain") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameTypeBlockchain" ON "dbo"."asset"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameBlockchain" ON "dbo"."asset" ("name", "blockchain") `);
    }
}
