/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportIssueTemplate1779195210427 {
  name = 'AddSupportIssueTemplate1779195210427';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "support_issue_template" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_8fde0595720bffbf28239c51d6c" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_f905631c6c854bc95d60e9d0361" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "contentDe" nvarchar(MAX) NOT NULL, "contentEn" nvarchar(MAX), "authorId" int NOT NULL, "authorMail" nvarchar(256) NOT NULL, CONSTRAINT "PK_caa8aaf252518b9cd9272d84ae4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_0f07bfe54fccedb688641354d2" ON "support_issue_template" ("name") `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_0f07bfe54fccedb688641354d2" ON "support_issue_template"`);
    await queryRunner.query(`DROP TABLE "support_issue_template"`);
  }
};
