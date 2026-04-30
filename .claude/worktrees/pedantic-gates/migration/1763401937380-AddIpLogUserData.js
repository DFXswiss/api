/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddIpLogUserData1763401937380 {
    name = 'AddIpLogUserData1763401937380'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ADD "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "ip_log" ADD CONSTRAINT "FK_b91fc10a7418de64ff2b0b2d2c6" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" DROP CONSTRAINT "FK_b91fc10a7418de64ff2b0b2d2c6"`);
        await queryRunner.query(`ALTER TABLE "ip_log" DROP COLUMN "userDataId"`);
    }
}
