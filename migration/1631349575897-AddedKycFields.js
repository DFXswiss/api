const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedKycFields1631349575897 {
    name = 'AddedKycFields1631349575897'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nameCheckOverrideDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nameCheckOverrideComment" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycStatus" varchar(256) NOT NULL CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba" DEFAULT 'NA'`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycFileReference" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycRequestDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycFailure" bit NOT NULL CONSTRAINT "DF_e1d9a9f5c2249608116e8aa8fc0" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_e1d9a9f5c2249608116e8aa8fc0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycFailure"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycRequestDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycFileReference"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_73409edce0fce7db304d3e5b5ba"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycStatus"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nameCheckOverrideComment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nameCheckOverrideDate"`);
    }
}
