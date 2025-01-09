const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveMasterKeyWallet1732808206829 {
    name = 'RemoveMasterKeyWallet1732808206829'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "masterKey"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" ADD "masterKey" nvarchar(256)`);
    }
}
