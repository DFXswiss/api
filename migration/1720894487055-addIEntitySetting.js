const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addIEntitySetting1720894487055 {
    name = 'addIEntitySetting1720894487055'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD "id" int NOT NULL IDENTITY(1,1)`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP CONSTRAINT "PK_1c4c95d773004250c157a744d6e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD CONSTRAINT "PK_fcb21187dc6094e24a48f677bed" PRIMARY KEY ("id")`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD CONSTRAINT "UQ_1c4c95d773004250c157a744d6e" UNIQUE ("key")`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD "updated" datetime2 NOT NULL CONSTRAINT "DF_2c9fe777c7cb794bb60678e353d" DEFAULT getdate()`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD "created" datetime2 NOT NULL CONSTRAINT "DF_5a82e1557167dffd637b2694ecc" DEFAULT getdate()`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP CONSTRAINT "DF_5a82e1557167dffd637b2694ecc"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP COLUMN "created"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP CONSTRAINT "DF_2c9fe777c7cb794bb60678e353d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP COLUMN "updated"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP CONSTRAINT "UQ_1c4c95d773004250c157a744d6e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP CONSTRAINT "PK_fcb21187dc6094e24a48f677bed"`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" ADD CONSTRAINT "PK_1c4c95d773004250c157a744d6e" PRIMARY KEY ("key")`);
        await queryRunner.query(`ALTER TABLE "dbo"."setting" DROP COLUMN "id"`);
    }
}
