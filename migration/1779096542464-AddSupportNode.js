/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportNode1779096542464 {
  name = 'AddSupportNode1779096542464';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "support_note" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_0808df6f9b73cd053eabaa41038" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_44fc0bddcb58532cdb9218636fd" DEFAULT getdate(), "userDataId" int, "department" nvarchar(256) NOT NULL, "authorId" int NOT NULL, "authorMail" nvarchar(256) NOT NULL, "subject" nvarchar(256), "content" nvarchar(MAX) NOT NULL, CONSTRAINT "PK_50d71a126818b986dfd11f3cc4c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1824182fbb53ca85959eedda54" ON "support_note" ("userDataId") `);
    await queryRunner.query(
      `ALTER TABLE "support_note" ADD CONSTRAINT "FK_1824182fbb53ca85959eedda54d" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "support_note" DROP CONSTRAINT "FK_1824182fbb53ca85959eedda54d"`);
    await queryRunner.query(`DROP INDEX "IDX_1824182fbb53ca85959eedda54" ON "support_note"`);
    await queryRunner.query(`DROP TABLE "support_note"`);
  }
};
