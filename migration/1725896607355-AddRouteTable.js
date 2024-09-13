const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddRouteTable1725896607355 {
    name = 'AddRouteTable1725896607355'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "route" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_248010a15480910c238089cccf5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b953361324c1845332abf4f1cbc" DEFAULT getdate(), "label" nvarchar(256), CONSTRAINT "PK_08affcd076e46415e5821acf52d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9ab4a290e0d5135be4b6aaf718" ON "route" ("label") WHERE label IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "routeId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "routeId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_dbb860811c8638e48ad4b1cbef" ON "dbo"."deposit_route" ("routeId") WHERE "routeId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a7273e02db5d66371968e00bda" ON "dbo"."buy" ("routeId") WHERE "routeId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_dbb860811c8638e48ad4b1cbef6" FOREIGN KEY ("routeId") REFERENCES "route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_a7273e02db5d66371968e00bda2" FOREIGN KEY ("routeId") REFERENCES "route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_a7273e02db5d66371968e00bda2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_dbb860811c8638e48ad4b1cbef6"`);
        await queryRunner.query(`DROP INDEX "REL_a7273e02db5d66371968e00bda" ON "dbo"."buy"`);
        await queryRunner.query(`DROP INDEX "REL_dbb860811c8638e48ad4b1cbef" ON "dbo"."deposit_route"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "routeId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "routeId"`);
        await queryRunner.query(`DROP INDEX "IDX_9ab4a290e0d5135be4b6aaf718" ON "route"`);
        await queryRunner.query(`DROP TABLE "route"`);
    }
}
