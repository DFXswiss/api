const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MoveKycFileRelation1633385141530 {
    name = 'MoveKycFileRelation1633385141530'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" DROP CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed"`);
        await queryRunner.query(`DROP INDEX "REL_a34b22e4385a7cac26e16ab89e" ON "dbo"."kyc_file"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" DROP COLUMN "userDataId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" ADD "userDataId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a34b22e4385a7cac26e16ab89e" ON "dbo"."kyc_file" ("userDataId") WHERE ([userDataId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" ADD CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed" FOREIGN KEY ("userDataId") REFERENCES ."user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
