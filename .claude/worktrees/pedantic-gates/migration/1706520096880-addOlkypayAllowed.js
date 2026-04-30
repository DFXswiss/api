const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addOlkypayAllowed1706520096880 {
    name = 'addOlkypayAllowed1706520096880'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "olkypayAllowed" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "olkypayAllowed"`);
    }
}
