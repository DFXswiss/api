const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class userRefIndex1678184308215 {
    name = 'userRefIndex1678184308215'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_33cb92da5789430ea5bbea3d5a" ON "user" ("ref") WHERE ref IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_33cb92da5789430ea5bbea3d5a" ON "user"`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198" UNIQUE ("ref")`);
    }
}
