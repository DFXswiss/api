/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class MonthlyVolume1768216257525 {
    name = 'MonthlyVolume1768216257525'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD "monthlyVolume" float CONSTRAINT "DF_65fa016979e56325f08fcdebd9f" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "monthlyBuyVolume" float NOT NULL CONSTRAINT "DF_69fd224d86005d56d0bfc42e783" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "monthlySellVolume" float NOT NULL CONSTRAINT "DF_8b0a3a1acd4e2a9ec6ac9b22f0a" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "monthlyCryptoVolume" float NOT NULL CONSTRAINT "DF_c2bc7d2a9c5923a33cd61f3cd9d" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "buy" ADD "monthlyVolume" float NOT NULL CONSTRAINT "DF_ae3f992d494992c7b5bd3c098f2" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "monthlyBuyVolume" float NOT NULL CONSTRAINT "DF_b71cae68540eac82fa1aff6e553" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "monthlySellVolume" float NOT NULL CONSTRAINT "DF_9c2e491c0ea4fc32aed0721c830" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "monthlyCryptoVolume" float NOT NULL CONSTRAINT "DF_57236c7391c6825b830c1ba49ba" DEFAULT 0`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_57236c7391c6825b830c1ba49ba"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "monthlyCryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_9c2e491c0ea4fc32aed0721c830"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "monthlySellVolume"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_b71cae68540eac82fa1aff6e553"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "monthlyBuyVolume"`);
        await queryRunner.query(`ALTER TABLE "buy" DROP CONSTRAINT "DF_ae3f992d494992c7b5bd3c098f2"`);
        await queryRunner.query(`ALTER TABLE "buy" DROP COLUMN "monthlyVolume"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_c2bc7d2a9c5923a33cd61f3cd9d"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "monthlyCryptoVolume"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_8b0a3a1acd4e2a9ec6ac9b22f0a"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "monthlySellVolume"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_69fd224d86005d56d0bfc42e783"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "monthlyBuyVolume"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "DF_65fa016979e56325f08fcdebd9f"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP COLUMN "monthlyVolume"`);
    }
}
