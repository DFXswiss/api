// Add "Josh" to the supportClerks setting so he becomes selectable as a clerk in the support
// dashboard (GET /support/issue/clerks reads this setting; the frontend populates the clerk
// dropdown from it). supportClerks is a JSON string array (see setting-schema.registry.ts:
// supportClerks: 'string[]'), so this reads the current value, appends "Josh" only if missing,
// and writes the full array back — existing clerks are preserved. Idempotent: re-running is a
// no-op once "Josh" is present. If the row does not exist yet, it is created.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class AddSupportClerkJosh1781871148903 {
  name = 'AddSupportClerkJosh1781871148903';

  async up(queryRunner) {
    // .at(0) instead of array destructuring: the migration-psql-check flags brackets around a word
    // as MSSQL bracket quoting
    const row = (await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'supportClerks'`)).at(0);
    const clerks = row ? JSON.parse(row.value) : [];

    if (clerks.includes('Josh')) return;
    clerks.push('Josh');

    if (row) {
      await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = 'supportClerks'`, [
        JSON.stringify(clerks),
      ]);
    } else {
      await queryRunner.query(
        `INSERT INTO "setting" ("key", "value", "created", "updated") VALUES ('supportClerks', $1, NOW(), NOW())`,
        [JSON.stringify(clerks)],
      );
    }
  }

  async down(queryRunner) {
    const row = (await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'supportClerks'`)).at(0);
    if (!row) return;

    const clerks = JSON.parse(row.value).filter((clerk) => clerk !== 'Josh');
    await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = 'supportClerks'`, [
      JSON.stringify(clerks),
    ]);
  }
};
