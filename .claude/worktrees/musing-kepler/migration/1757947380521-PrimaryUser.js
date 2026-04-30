/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PrimaryUser1757947380521 {
    name = 'PrimaryUser1757947380521'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "primaryUserId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_3d123a28635558f206e57fc9084" FOREIGN KEY ("primaryUserId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_3d123a28635558f206e57fc9084"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "primaryUserId"`);
    }
}
