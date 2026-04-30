const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataCols1663921954240 {
    name = 'addUserDataCols1663921954240'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "birthday" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nationalityId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_89c1ece4cd00924230fc0b92c52" FOREIGN KEY ("nationalityId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_89c1ece4cd00924230fc0b92c52"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nationalityId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "birthday"`);
    }
}
