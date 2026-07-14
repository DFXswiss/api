// Enable individual DFX onboarding for the Philippines.
//
// The Philippines is no longer subject to FATF increased monitoring and its country row is already
// FATF-enabled. The remaining dfxEnable=false flag keeps it out of the DFX KYC country list and also
// makes bankAllowed false in the public country DTO. Keep organization onboarding and all unrelated
// country controls unchanged. This regulatory allow-list change is intentionally one-way: reverting an
// application deployment must not silently block the country again. A future restriction requires its
// own explicit migration and compliance review.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class EnablePhilippinesOnboarding1784029705806 {
  name = 'EnablePhilippinesOnboarding1784029705806';

  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "country" SET "dfxEnable" = true, "updated" = NOW() WHERE "symbol" = 'PH' AND "dfxEnable" = false`,
    );
  }

  async down(_queryRunner) {
    // Intentionally empty: country restrictions are compliance data and must be changed explicitly.
  }
};
