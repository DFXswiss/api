/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportReplySuggestion1786169975000 {
  name = 'AddSupportReplySuggestion1786169975000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "support_reply_suggestion" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "text" text NOT NULL, "state" character varying(256) NOT NULL DEFAULT 'Pending', "authorId" integer NOT NULL, "handledById" integer, "handled" TIMESTAMP, "issueId" integer NOT NULL, "messageId" integer NOT NULL, CONSTRAINT "PK_8daa417e8e4722c2b31094790e5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3c1f23805d75014371ca66d00" ON "support_reply_suggestion" ("issueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f28064cba21f307c928ac6e6b5" ON "support_reply_suggestion" ("messageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "support_reply_suggestion" ADD CONSTRAINT "FK_f3c1f23805d75014371ca66d005" FOREIGN KEY ("issueId") REFERENCES "support_issue"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "support_reply_suggestion" ADD CONSTRAINT "FK_f28064cba21f307c928ac6e6b54" FOREIGN KEY ("messageId") REFERENCES "support_message"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "support_reply_suggestion" DROP CONSTRAINT "FK_f28064cba21f307c928ac6e6b54"`);
    await queryRunner.query(`ALTER TABLE "support_reply_suggestion" DROP CONSTRAINT "FK_f3c1f23805d75014371ca66d005"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f28064cba21f307c928ac6e6b5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f3c1f23805d75014371ca66d00"`);
    await queryRunner.query(`DROP TABLE "support_reply_suggestion"`);
  }
};
