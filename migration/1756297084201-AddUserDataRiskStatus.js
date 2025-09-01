const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataRiskStatus1756297084201 {
    name = 'AddUserDataRiskStatus1756297084201'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskStatus" nvarchar(256) NOT NULL CONSTRAINT "DF_2e4a8725af58f310249d5ea34ba" DEFAULT 'NA'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_2e4a8725af58f310249d5ea34ba"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskStatus"`);
    }
}
