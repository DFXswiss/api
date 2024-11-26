const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserIpLog1730310677880 {
    name = 'AddUserIpLog1730310677880'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ADD "userId" int`);
        await queryRunner.query(`ALTER TABLE "ip_log" ADD CONSTRAINT "FK_8efce822823d601f342809a5f54" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" DROP CONSTRAINT "FK_8efce822823d601f342809a5f54"`);
        await queryRunner.query(`ALTER TABLE "ip_log" DROP COLUMN "userId"`);
    }
}
