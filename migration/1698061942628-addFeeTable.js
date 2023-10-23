const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeTable1698061942628 {
    name = 'addFeeTable1698061942628'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "fee" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e6551fb2bd23c853d917c1f13c5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_f7c1757e877b3e7b1e8d69eaa3d" DEFAULT getdate(), "label" nvarchar(256) NOT NULL, "type" nvarchar(256) NOT NULL, "value" float NOT NULL, "discountCode" nvarchar(256), "accountType" nvarchar(256), "direction" nvarchar(256), "expiryDate" datetime2, "maxTxVolume" float, "assets" nvarchar(256), "maxUsages" float, CONSTRAINT "PK_ee7e51cc563615bc60c2b234635" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4fa8fdf9a8afbd9c6b1da6a69f" ON "fee" ("label", "direction") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "individualFees" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "individualFees"`);
        await queryRunner.query(`DROP INDEX "IDX_4fa8fdf9a8afbd9c6b1da6a69f" ON "fee"`);
        await queryRunner.query(`DROP TABLE "fee"`);
    }
}
