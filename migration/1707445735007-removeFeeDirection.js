const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeFeeDirection1707445735007 {
    name = 'removeFeeDirection1707445735007'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_4fa8fdf9a8afbd9c6b1da6a69f" ON "dbo"."fee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "direction"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "paymentMethodIn" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "paymentMethodOut" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "paymentMethodOut"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "paymentMethodIn"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "direction" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4fa8fdf9a8afbd9c6b1da6a69f" ON "dbo"."fee" ("label", "direction") `);
    }
}
