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
// Env-guarded: up() is a no-op when no matching rows exist (staging/dev have no
// data in this date range, so no side-effects on non-production environments).
//
// down() is best-effort: it re-stamps valid=true on the same date/threshold window.
// It cannot distinguish rows that were already valid=false before up() ran, so it
// may over-restore a small number of entries.  Given the one-shot nature of this
// fix and the narrow date range, this is an accepted limitation.
module.exports = class MarkHighTotalBalanceLogsAsInvalid1781520348153 {
  name = 'MarkHighTotalBalanceLogsAsInvalid1781520348153';

  async up(queryRunner) {
    const affected = await queryRunner.query(`
      SELECT id FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = true
    `);
    if (!affected.length) return;

    const ids = affected.map((r) => r.id).join(',');
    await queryRunner.query(`UPDATE log SET valid = false WHERE id IN (${ids})`);
  }

  async down(queryRunner) {
    const affected = await queryRunner.query(`
      SELECT id FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-08T13:12:39Z'
        AND  created  <= '2026-06-15T10:30:34Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = false
    `);
    if (!affected.length) return;

    const ids = affected.map((r) => r.id).join(',');
    await queryRunner.query(`UPDATE log SET valid = true WHERE id IN (${ids})`);
  }
};
