const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveLimitRequestCols1726061526398 {
    name = 'RemoveLimitRequestCols1726061526398'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP CONSTRAINT "FK_2c2446fedd9bb64eabf0c33bc37"`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "documentProofUrl"`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "userDataId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "userDataId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "documentProofUrl" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD CONSTRAINT "FK_2c2446fedd9bb64eabf0c33bc37" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
