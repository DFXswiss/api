/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportNote1777635135000 {
  name = 'AddSupportNote1777635135000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "support_note" (` +
        `"id" int NOT NULL IDENTITY(1,1), ` +
        `"updated" datetime2 NOT NULL CONSTRAINT "DF_support_note_updated" DEFAULT getdate(), ` +
        `"created" datetime2 NOT NULL CONSTRAINT "DF_support_note_created" DEFAULT getdate(), ` +
        `"department" nvarchar(256) NOT NULL, ` +
        `"authorId" int NOT NULL, ` +
        `"authorMail" nvarchar(256) NOT NULL, ` +
        `"subject" nvarchar(256), ` +
        `"content" nvarchar(MAX) NOT NULL, ` +
        `"userDataId" int, ` +
        `CONSTRAINT "PK_support_note" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_support_note_userDataId" ON "support_note" ("userDataId")`);
    await queryRunner.query(
      `ALTER TABLE "support_note" ADD CONSTRAINT "FK_support_note_userDataId" ` +
        `FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "support_note" DROP CONSTRAINT "FK_support_note_userDataId"`);
    await queryRunner.query(`DROP INDEX "IDX_support_note_userDataId" ON "support_note"`);
    await queryRunner.query(`DROP TABLE "support_note"`);
  }
};
