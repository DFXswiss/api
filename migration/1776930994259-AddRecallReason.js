/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRecallReason1776930994259 {
    name = 'AddRecallReason1776930994259'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recall" ADD "reason" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "recall" DROP COLUMN "reason"`);
    }
}
