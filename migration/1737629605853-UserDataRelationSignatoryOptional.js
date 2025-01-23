const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserDataRelationSignatoryOptional1737629605853 {
    name = 'UserDataRelationSignatoryOptional1737629605853'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data_relation" ALTER COLUMN "signatory" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data_relation" ALTER COLUMN "signatory" nvarchar(256) NOT NULL`);
    }
}
