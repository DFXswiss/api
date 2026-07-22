/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixFiatOutputValutaDateSerials1784600000011 {
  name = 'FixFiatOutputValutaDateSerials1784600000011';

  /**
   * Spreadsheet date serials were sent as numbers and class-transformer interpreted them as
   * milliseconds since 1970-01-01, yielding broken 1970 timestamps. The millisecond portion equals
   * the original serial (days since 1899-12-30); conversion is deterministic within the serial
   * window for dates from 2000-01-01 (serial 36526) to the observed maximum (serial ~46300 /
   * 1970-01-01 00:00:46.300):
   * "valutaDate" >= TIMESTAMP '1970-01-01 00:00:36.526' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
   * Known 1970-01-01T00:00:00.001Z legacy values exist only in "isReadyDate", never in "valutaDate",
   * and lie outside this window (no overlap).
   *
   * Audit and repair run in a single atomic statement with a shared row snapshot (data-modifying
   * CTEs): there is no window between audit insert and mutation in which concurrent changes could
   * be repaired without being logged. Affected rows are locked with FOR UPDATE. The final UPDATE
   * is gated by EXISTS on the audit CTE so audit-before-mutation is structurally enforced, not only
   * implied by statement atomicity.
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Millisecond epoch offset is the spreadsheet serial; add that many days to 1899-12-30.
    // Audit + repair share one snapshot via data-modifying CTEs (fail closed if insert fails).
    await queryRunner.query(`
WITH "affected" AS (
  SELECT "id", "valutaDate",
    TIMESTAMP '1899-12-30 00:00:00' + ROUND(EXTRACT(EPOCH FROM "valutaDate") * 1000) * INTERVAL '1 day' AS "repairedDate"
  FROM "fiat_output"
  WHERE "valutaDate" >= TIMESTAMP '1970-01-01 00:00:36.526' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'FiatOutput', 'ValutaDateSerialRepair', 'Info',
    json_agg(json_build_object(
      'id', "id",
      'before', to_char("valutaDate", 'YYYY-MM-DD HH24:MI:SS.MS'),
      'after', to_char("repairedDate", 'YYYY-MM-DD HH24:MI:SS.MS')
    ))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "fiat_output" f
SET "valutaDate" = a."repairedDate"
FROM "affected" a
WHERE f."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`);
  }

  /**
   * Restore previous "valutaDate" values exclusively from the newest audit log entry written by
   * up() (system='FiatOutput', subsystem='ValutaDateSerialRepair'). Restores only rows still holding
   * the audited 'after' value (guard against silently destroying legitimate post-repair corrections).
   * Writes its own rollback audit log entry (subsystem='ValutaDateSerialRepairRollback') before the
   * mutation in the same atomic statement. No calendar-date or midnight heuristic: legitimate
   * production valutaDates frequently are exactly midnight UTC (00:00:00.000), so a
   * date_trunc/midnight check would falsely reverse thousands of valid rows. Missing audit log
   * yields a no-op (0 rows). Restorable rows are locked with FOR UPDATE OF f; the after-guard is
   * re-checked at update time. The final UPDATE is gated by EXISTS on the rollback audit CTE so
   * audit-before-mutation is structurally enforced, not only implied by statement atomicity.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
WITH "auditSource" AS (
  SELECT "id" AS "logId", "message" FROM "log"
  WHERE "system" = 'FiatOutput' AND "subsystem" = 'ValutaDateSerialRepair'
  ORDER BY "id" DESC LIMIT 1
),
"entries" AS (
  SELECT s."logId", jsonb_array_elements(s."message"::jsonb) AS "elem" FROM "auditSource" s
),
"restorable" AS (
  SELECT e."logId", (e."elem"->>'id')::int AS "rowId",
    (e."elem"->>'before')::timestamp AS "beforeValue",
    (e."elem"->>'after')::timestamp AS "afterValue"
  FROM "entries" e
  JOIN "fiat_output" f ON f."id" = (e."elem"->>'id')::int
  WHERE f."valutaDate" = (e."elem"->>'after')::timestamp
  FOR UPDATE OF f
),
"rollbackAudit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'FiatOutput', 'ValutaDateSerialRepairRollback', 'Info',
    json_agg(json_build_object(
      'sourceLogId', "logId",
      'id', "rowId",
      'before', to_char("afterValue", 'YYYY-MM-DD HH24:MI:SS.MS'),
      'after', to_char("beforeValue", 'YYYY-MM-DD HH24:MI:SS.MS')
    ))::text
  FROM "restorable"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "fiat_output" f
SET "valutaDate" = r."beforeValue"
FROM "restorable" r
WHERE f."id" = r."rowId" AND f."valutaDate" = r."afterValue" AND EXISTS (SELECT 1 FROM "rollbackAudit");
`);
  }
};
