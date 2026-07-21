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
    // Fail loud if the PH country row is missing: a blind UPDATE would report success while
    // silently leaving the Philippines disabled. This is a compliance allow-list change, so it
    // must be auditable and fail-closed rather than a silent no-op.
    const [existing] = await queryRunner.query(`SELECT "dfxEnable" FROM "country" WHERE "symbol" = 'PH'`);
    if (!existing) {
      throw new Error(
        'EnablePhilippinesOnboarding: country row for PH not found — aborting so onboarding is not silently left disabled',
      );
    }

    // Guarded on dfxEnable=false so a re-run (or an already-enabled row) is a no-op and does not bump "updated".
    await queryRunner.query(
      `UPDATE "country" SET "dfxEnable" = true, "updated" = NOW() WHERE "symbol" = 'PH' AND "dfxEnable" = false`,
    );
  }

  async down(_queryRunner) {
    // Intentionally empty: country restrictions are compliance data and must be changed explicitly.
  }
};
