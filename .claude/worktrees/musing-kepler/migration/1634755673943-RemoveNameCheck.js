const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveNameCheck1634755673943 {
    name = 'RemoveNameCheck1634755673943'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nameCheck"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nameCheck" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_a9011ebc9f200db6e0ee16166d4" DEFAULT 'NA' FOR "nameCheck"`);
    }
}
