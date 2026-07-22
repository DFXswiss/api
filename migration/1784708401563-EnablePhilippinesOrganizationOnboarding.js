// Enable organization (business) DFX onboarding for the Philippines.
//
// Individual onboarding was enabled in #4206 (dfxEnable=true), but organization onboarding was
// intentionally left off (dfxOrganizationEnable=false). That flag keeps kycOrganizationAllowed=false
// in the public country DTO (so the app hides PH from the business address list) and makes the
// business KYC country gate reject PH (kyc.service business branch -> COUNTRY_NOT_ALLOWED). This
// migration enables organization onboarding as well. Manual-review controls
// (manualReviewRequiredOrganization) and all unrelated country controls are intentionally unchanged.
// Like the individual enablement, this regulatory allow-list change is one-way: reverting an
// application deployment must not silently block the country again. A future restriction requires its
// own explicit migration and compliance review.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class EnablePhilippinesOrganizationOnboarding1784708401563 {
  name = 'EnablePhilippinesOrganizationOnboarding1784708401563';

  async up(queryRunner) {
    // Fail loud if the PH country row is missing: a blind UPDATE would report success while silently
    // leaving organization onboarding disabled. This is a compliance allow-list change, so it must be
    // auditable and fail-closed rather than a silent no-op.
    // NOTE: avoid array destructuring / index access here — the migration PostgreSQL-compatibility
    // guard (migration-psql-check.spec.ts) flags square-bracket identifier tokens as MSSQL bracket quoting.
    const existing = await queryRunner.query(`SELECT "dfxOrganizationEnable" FROM "country" WHERE "symbol" = 'PH'`);
    if (!existing.length) {
      throw new Error(
        'EnablePhilippinesOrganizationOnboarding: country row for PH not found — aborting so organization onboarding is not silently left disabled',
      );
    }

    // Guarded on dfxOrganizationEnable=false so a re-run (or an already-enabled row) is a no-op and does not bump "updated".
    await queryRunner.query(
      `UPDATE "country" SET "dfxOrganizationEnable" = true, "updated" = NOW() WHERE "symbol" = 'PH' AND "dfxOrganizationEnable" = false`,
    );
  }

  async down(_queryRunner) {
    // Intentionally empty: country restrictions are compliance data and must be changed explicitly.
  }
};
