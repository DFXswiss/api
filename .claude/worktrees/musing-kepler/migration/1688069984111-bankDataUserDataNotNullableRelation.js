const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankDataUserDataNotNullableRelation1688069984111 {
    name = 'bankDataUserDataNotNullableRelation1688069984111'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "userDataId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
