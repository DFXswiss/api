const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMaerkiBaumannEnable1662081355184 {
    name = 'addMaerkiBaumannEnable1662081355184'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "maerkiBaumannEnable" bit NOT NULL CONSTRAINT "DF_687dc858f7aff3f03ffbb214f2c" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_687dc858f7aff3f03ffbb214f2c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "maerkiBaumannEnable"`);
    }
}
