const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class kycHashToUUID1659083576871 {
    name = 'kycHashToUUID1659083576871'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_ae1f8052958afa82055fdef34f" ON "user_data"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "kycHash"`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "kycHash" uniqueidentifier NOT NULL CONSTRAINT "DF_4111b4eab979dc55b675cb6e0c2" DEFAULT NEWSEQUENTIALID()`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data" ("kycHash") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_4111b4eab979dc55b675cb6e0c" ON "user_data"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "kycHash"`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "kycHash" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ae1f8052958afa82055fdef34f" ON "user_data" ("kycHash") WHERE ([kycHash] IS NOT NULL)`);
    }
}
