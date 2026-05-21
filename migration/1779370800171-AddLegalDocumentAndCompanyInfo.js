/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds the `legal_document` and `company_info` reference tables and the
 * `country.displayOrder` column, then seeds:
 * - the legal-document URLs currently hardcoded in the realunit-app
 *   (`lib/packages/config/legal_documents_config.dart:69-122`),
 * - the RealUnit company contact info hardcoded in
 *   (`lib/screens/settings_contact/settings_contact_page.dart:82-134`),
 * - the priority country order the realunit-app's country picker
 *   uses (`lib/widgets/form/country_field.dart:65-79` —
 *   `['CH','DE','IT','FR']`).
 *
 * Closes V14, V17, V18 in
 * `DFXswiss/realunit-app:docs/api-authority-audit.md`.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLegalDocumentAndCompanyInfo1779370800171 {
  name = 'AddLegalDocumentAndCompanyInfo1779370800171';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // --- legal_document table ---
    await queryRunner.query(
      `CREATE TABLE "legal_document" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_legal_document_updated" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_legal_document_created" DEFAULT getdate(), "type" nvarchar(64) NOT NULL, "language" nvarchar(8), "version" nvarchar(32) NOT NULL, "url" nvarchar(1024) NOT NULL, "enabled" bit NOT NULL CONSTRAINT "DF_legal_document_enabled" DEFAULT 1, CONSTRAINT "PK_legal_document" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_legal_document_type_language" ON "legal_document" ("type", "language") WHERE "enabled" = 1`,
    );

    // --- company_info table ---
    await queryRunner.query(
      `CREATE TABLE "company_info" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_company_info_updated" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_company_info_created" DEFAULT getdate(), "brand" nvarchar(64) NOT NULL, "name" nvarchar(256) NOT NULL, "phone" nvarchar(64), "email" nvarchar(256), "website" nvarchar(256), "addressStreet" nvarchar(256), "addressZip" nvarchar(64), "addressCity" nvarchar(256), "addressCountry" nvarchar(8), "enabled" bit NOT NULL CONSTRAINT "DF_company_info_enabled" DEFAULT 1, CONSTRAINT "PK_company_info" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_company_info_brand" ON "company_info" ("brand") WHERE "enabled" = 1`,
    );

    // --- country.displayOrder column ---
    await queryRunner.query(
      `ALTER TABLE "country" ADD "displayOrder" int NOT NULL CONSTRAINT "DF_country_displayOrder" DEFAULT 999`,
    );
    // Seed the priority order the realunit-app used to hardcode:
    //   const priorityCountries = ['CH', 'DE', 'IT', 'FR']
    await queryRunner.query(`UPDATE "country" SET "displayOrder" = 1 WHERE "symbol" = 'CH'`);
    await queryRunner.query(`UPDATE "country" SET "displayOrder" = 2 WHERE "symbol" = 'DE'`);
    await queryRunner.query(`UPDATE "country" SET "displayOrder" = 3 WHERE "symbol" = 'IT'`);
    await queryRunner.query(`UPDATE "country" SET "displayOrder" = 4 WHERE "symbol" = 'FR'`);

    // --- seed legal_document with the URLs the realunit-app used to ship hardcoded ---
    const legalDocs = [
      { type: 'RegistrationAgreement', language: 'de', version: '1.0', url: 'https://realunit.de/agreement-de.pdf' },
      { type: 'RegistrationAgreement', language: 'en', version: '1.0', url: 'https://realunit.de/agreement-en.pdf' },
      { type: 'Prospectus', language: 'de', version: '1.0', url: 'https://realunit.de/prospekt-de.pdf' },
      { type: 'Prospectus', language: 'en', version: '1.0', url: 'https://realunit.ch/prospectus-en.pdf' },
      { type: 'AktionariatTerms', language: null, version: '1.0', url: 'https://www.aktionariat.com/terms' },
      { type: 'AktionariatPrivacy', language: null, version: '1.0', url: 'https://www.aktionariat.com/privacy' },
      { type: 'DfxTerms', language: null, version: '1.0', url: 'https://docs.dfx.swiss/en/terms.html' },
      { type: 'DfxPrivacy', language: null, version: '1.0', url: 'https://docs.dfx.swiss/en/privacy-policy.html' },
    ];
    for (const doc of legalDocs) {
      await queryRunner.query(
        `INSERT INTO "legal_document" ("type", "language", "version", "url", "enabled") VALUES (@0, @1, @2, @3, 1)`,
        [doc.type, doc.language, doc.version, doc.url],
      );
    }

    // --- seed company_info with the contact info the realunit-app used to ship hardcoded ---
    await queryRunner.query(
      `INSERT INTO "company_info" ("brand", "name", "phone", "email", "website", "addressStreet", "addressZip", "addressCity", "addressCountry", "enabled") VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, 1)`,
      [
        'RealUnit',
        'RealUnit Schweiz AG',
        '+41 41 761 00 90',
        'info@realunit.ch',
        'realunit.ch',
        'Schochenmühlestrasse 6',
        '6340',
        'Baar',
        'CH',
      ],
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_country_displayOrder"`);
    await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "displayOrder"`);

    await queryRunner.query(`DROP INDEX "IDX_company_info_brand" ON "company_info"`);
    await queryRunner.query(`DROP TABLE "company_info"`);

    await queryRunner.query(`DROP INDEX "IDX_legal_document_type_language" ON "legal_document"`);
    await queryRunner.query(`DROP TABLE "legal_document"`);
  }
};
