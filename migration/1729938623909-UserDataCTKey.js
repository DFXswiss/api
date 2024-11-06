const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserDataCTKey1729938623909 {
    name = 'UserDataCTKey1729938623909'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "apiKeyCT" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "apiFilterCT" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_49048869a74fb487e3da897ba7" ON "dbo"."user_data" ("apiKeyCT") WHERE apiKeyCT IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_49048869a74fb487e3da897ba7" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "apiFilterCT"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "apiKeyCT"`);
    }
}
