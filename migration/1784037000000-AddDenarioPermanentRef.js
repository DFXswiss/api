/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const REF_SETTING_KEY = 'ref-keys';
const DENARIO_ALIAS = 'denario';
const DENARIO_ORGANIZATION_NAMES = ['denario', 'denario ag'];
const REF_CODE_FORMAT = /^\w{1,3}-\w{1,3}$/;

/**
 * Parse the ref-keys setting without silently replacing corrupt configuration.
 *
 * @param {{ value: string } | undefined} row
 * @returns {Record<string, string>}
 */
function parseRefKeys(row) {
  if (!row) return {};

  let refKeys;
  try {
    refKeys = JSON.parse(row.value);
  } catch {
    throw new Error(`Setting '${REF_SETTING_KEY}' does not contain valid JSON`);
  }

  if (!refKeys || typeof refKeys !== 'object' || Array.isArray(refKeys)) {
    throw new Error(`Setting '${REF_SETTING_KEY}' must contain a JSON object`);
  }

  return refKeys;
}

/**
 * Resolve the environment-specific referral code from the Denario organization account.
 * Production and development assign referral codes independently, so persisting one numeric
 * code in source would inevitably point at the wrong account in one of the environments.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<string>}
 */
async function resolveDenarioRef(queryRunner) {
  const rows = await queryRunner.query(
    `
      SELECT DISTINCT u."ref" AS "ref"
      FROM "user" u
      INNER JOIN "user_data" ud ON ud."id" = u."userDataId"
      WHERE LOWER(BTRIM(ud."organizationName")) IN ($1, $2)
        AND ud."accountType" = 'Organization'
        AND ud."status" = 'Active'
        AND u."status" = 'Active'
        AND u."ref" IS NOT NULL
      ORDER BY u."ref"
    `,
    DENARIO_ORGANIZATION_NAMES,
  );

  const refs = rows.map((row) => row.ref);
  if (refs.length === 0) {
    throw new Error(
      'No active Denario organization user with a referral code was found. ' +
        'Create and activate the Denario account in this environment before running the migration.',
    );
  }
  if (refs.length > 1) {
    throw new Error(`Denario referral target is ambiguous: found ${refs.length} active referral codes`);
  }
  const denarioRef = refs.at(0);
  if (!REF_CODE_FORMAT.test(denarioRef)) {
    throw new Error(`Denario account has an invalid referral code: '${denarioRef}'`);
  }

  return denarioRef;
}

/**
 * Adds the permanent `denario` alias to the environment-local `ref-keys` setting.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddDenarioPermanentRef1784037000000 {
  name = 'AddDenarioPermanentRef1784037000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const denarioRef = await resolveDenarioRef(queryRunner);
    const row = (
      await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = $1 FOR UPDATE`, Array.of(REF_SETTING_KEY))
    ).at(0);
    const refKeys = parseRefKeys(row);

    if (Object.prototype.hasOwnProperty.call(refKeys, DENARIO_ALIAS)) {
      if (Reflect.get(refKeys, DENARIO_ALIAS) === denarioRef) return;
      throw new Error(
        `Setting '${REF_SETTING_KEY}' already contains a conflicting '${DENARIO_ALIAS}' alias; refusing to overwrite it`,
      );
    }

    Reflect.set(refKeys, DENARIO_ALIAS, denarioRef);
    const value = JSON.stringify(refKeys);

    if (row) {
      await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`, [
        value,
        REF_SETTING_KEY,
      ]);
    } else {
      await queryRunner.query(
        `INSERT INTO "setting" ("key", "value", "created", "updated") VALUES ($1, $2, NOW(), NOW())`,
        [REF_SETTING_KEY, value],
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const row = (
      await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = $1 FOR UPDATE`, Array.of(REF_SETTING_KEY))
    ).at(0);
    if (!row) return;

    const refKeys = parseRefKeys(row);
    if (!Object.prototype.hasOwnProperty.call(refKeys, DENARIO_ALIAS)) return;

    Reflect.deleteProperty(refKeys, DENARIO_ALIAS);
    if (Object.keys(refKeys).length === 0) {
      await queryRunner.query(`DELETE FROM "setting" WHERE "key" = $1`, Array.of(REF_SETTING_KEY));
    } else {
      await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`, [
        JSON.stringify(refKeys),
        REF_SETTING_KEY,
      ]);
    }
  }
};
