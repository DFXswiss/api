/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ChangeRecommendationAliasNullable1764398247687 {
    name = 'ChangeRecommendationAliasNullable1764398247687'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recommendation" ALTER COLUMN "recommendedAlias" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recommendation" ALTER COLUMN "recommendedAlias" nvarchar(256) NOT NULL`);
    }
}
