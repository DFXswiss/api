const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedVolumes1640792213363 {
    name = 'AddedVolumes1640792213363'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "volume" float NOT NULL CONSTRAINT "DF_9dbc4c08bf35602dc6153e2b5c0" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "refVolume" float NOT NULL CONSTRAINT "DF_3f8573098696d6c2ba7075e8b30" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" ADD "volume" float NOT NULL CONSTRAINT "DF_cca6ffec6c5c15a7e5527b45b81" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP CONSTRAINT "DF_cca6ffec6c5c15a7e5527b45b81"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell" DROP COLUMN "volume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_3f8573098696d6c2ba7075e8b30"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "refVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "DF_9dbc4c08bf35602dc6153e2b5c0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "volume"`);
    }
}
