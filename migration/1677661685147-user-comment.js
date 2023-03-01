const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class userComment1677661685147 {
    name = 'userComment1677661685147'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "comment" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "status" nvarchar(256) NOT NULL CONSTRAINT "DF_41eed664b62fd5f406173e16a21" DEFAULT 'NA'`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "ref" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "ref" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_41eed664b62fd5f406173e16a21"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "comment"`);
    }
}
