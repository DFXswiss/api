/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RenameRecommendationTypeCreator1764324883039 {
    name = 'RenameRecommendationTypeCreator1764324883039'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename dbo.recommendation.type", "method"`);
        await queryRunner.query(`EXEC sp_rename dbo.recommendation.creator", "type"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename dbo.recommendation.type", "creator"`);
        await queryRunner.query(`EXEC sp_rename dbo.recommendation.method", "type"`);
    }
}
