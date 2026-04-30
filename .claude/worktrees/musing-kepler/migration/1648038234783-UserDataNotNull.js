const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserDataNotNull1648038234783 {
    name = 'UserDataNotNull1648038234783'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "userDataId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_22abf72351fb3a0c9cd84d88bb6" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
