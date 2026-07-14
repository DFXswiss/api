// Enable individual DFX onboarding for the Philippines.
//
// The Philippines is no longer subject to FATF increased monitoring and its country row is already
// FATF-enabled. The remaining dfxEnable=false flag keeps it out of the DFX KYC country list and also
// makes bankAllowed false in the public country DTO. Keep organization onboarding and all unrelated
// country controls unchanged.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class EnablePhilippinesOnboarding1784029705806 {
  name = 'EnablePhilippinesOnboarding1784029705806';

  async up(queryRunner) {
    await queryRunner.query(`UPDATE "country" SET "dfxEnable" = true WHERE "symbol" = 'PH' AND "dfxEnable" = false`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE "country" SET "dfxEnable" = false WHERE "symbol" = 'PH' AND "dfxEnable" = true`);
  }
};
