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
      `CREATE TABLE "legal_document" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "type" character varying(64) NOT NULL, "language" character varying(8), "version" character varying(32) NOT NULL, "url" character varying(1024) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_950166ad59d051a80cad8337c76" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c3408d5be699dbdc15f529c2ce" ON "legal_document" ("type", "language") WHERE "enabled" = true`,
    );

    // --- company_info table ---
    await queryRunner.query(
      `CREATE TABLE "company_info" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "brand" character varying(64) NOT NULL, "name" character varying(256) NOT NULL, "phone" character varying(64), "email" character varying(256), "website" character varying(256), "addressStreet" character varying(256), "addressZip" character varying(64), "addressCity" character varying(256), "addressCountry" character varying(8), "enabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_88c3e323679d0747ffbb83f3f78" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9a97b98884dfa6dfb6c8cc7b11" ON "company_info" ("brand") WHERE "enabled" = true`,
    );

    // --- country.displayOrder column ---
    await queryRunner.query(`ALTER TABLE "country" ADD "displayOrder" integer NOT NULL DEFAULT 999`);
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
        `INSERT INTO "legal_document" ("type", "language", "version", "url", "enabled") VALUES ($1, $2, $3, $4, true)`,
        [doc.type, doc.language, doc.version, doc.url],
      );
    }

    // --- seed company_info with the contact info the realunit-app used to ship hardcoded ---
    await queryRunner.query(
      `INSERT INTO "company_info" ("brand", "name", "phone", "email", "website", "addressStreet", "addressZip", "addressCity", "addressCountry", "enabled") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
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
    await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "displayOrder"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_9a97b98884dfa6dfb6c8cc7b11"`);
    await queryRunner.query(`DROP TABLE "company_info"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_c3408d5be699dbdc15f529c2ce"`);
    await queryRunner.query(`DROP TABLE "legal_document"`);
  }
};
