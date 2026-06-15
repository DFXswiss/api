// Between 2026-06-08 and 2026-06-15 a significant number of FinancialDataLog
// entries were incorrectly stamped valid=true despite carrying a totalBalanceChf
// that is implausibly high (> 50 000 CHF) compared to the expected operating-
// equity range.  The root cause was a transient accounting spike: plusBalanceChf
// jumped by > 200 000 CHF while large orders were pending, causing subsequent
// balance deltas to fall within financeLogTotalBalanceChangeLimit at the elevated
// baseline, so the invalid flag was never set.
//
// This migration retroactively corrects the valid flag so that monitoring
// dashboards and anomaly alerts accurately reflect the period.
//
// Affected range : 2026-06-08T13:12:39Z – 2026-06-15T10:30:34Z  (verified)
// Affected rows  : 3 969  (verified 2026-06-15 via /gs/debug COUNT query)
// Threshold      : totalBalanceChf > 50 000 (well above normal ~20–30 k band)
//
// Env-guarded: COUNT pre-check makes up() a no-op on staging/dev (no rows exist
// in this date range outside production).
//
// down() is best-effort: re-stamps valid=true for the same window/threshold.
// It cannot distinguish rows already invalid before up() ran, so it may over-
// restore a small number of entries — accepted for this one-shot fix.
module.exports = class MarkHighTotalBalanceLogsAsInvalid1781520348153 {
  name = 'MarkHighTotalBalanceLogsAsInvalid1781520348153';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = true
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = false
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = true
    `);
  }

  async down(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = false
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = true
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = false
    `);
  }
};
