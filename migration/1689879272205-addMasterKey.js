const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMasterKey1689879272205 {
    name = 'addMasterKey1689879272205'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "masterKey" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(700)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(700) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "masterKey"`);
    }
}
