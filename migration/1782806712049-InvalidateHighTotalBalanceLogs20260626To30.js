// FinancialDataLog entries created between 2026-06-26 and 2026-06-30 carry a
// totalBalanceChf that is implausibly high (> 90 000 CHF) compared to the expected
// operating-equity range, yet they were stamped valid=true. This is a recurrence of
// the same transient accounting spike handled for 2026-06-15 (see
// InvalidateHighTotalBalanceLogs 1781527084203), 2026-06-16 (see
// InvalidateHighTotalBalanceLogs 1781598468039), 2026-06-17 (see
// InvalidateHighTotalBalanceLogs 1781685299000), 2026-06-18 (see
// InvalidateHighTotalBalanceLogs 1781766233000), 2026-06-20 (see
// InvalidateHighTotalBalanceLogs 1781939033000) and 2026-06-24 (see
// InvalidateHighTotalBalanceLogs 1782292825333): plusBalanceChf jumped ahead of the
// corresponding minusBalanceChf booking, so deltas at the elevated baseline stayed
// within financeLogTotalBalanceChangeLimit and the invalid flag was never set. This
// migration marks those entries invalid so monitoring dashboards and anomaly alerts
// reflect the period correctly.
//
// Threshold : totalBalanceChf > 90 000 (raised from the 80 000 used on 2026-06-24).
//             The legitimate operating band keeps rising, so the cut is lifted again
//             to isolate the spike tail without flagging the normal band.
// Scope     : entries created from 2026-06-26 through 2026-06-30 (UTC), i.e.
//             created >= 2026-06-26T00:00:00Z AND created < 2026-07-01T00:00:00Z, no
//             upper time-of-day bound so every affected row of those days is covered
//             regardless of sub-second timing.
//
// Env-guarded: the COUNT pre-check makes up() a no-op where no rows match
// (staging/dev). down() re-stamps valid=true for the same window/threshold; it
// cannot distinguish rows already invalid before up() ran, so it may over-restore
// a small number of entries — accepted for this one-shot fix.
module.exports = class InvalidateHighTotalBalanceLogs1782806712049 {
  name = 'InvalidateHighTotalBalanceLogs1782806712049';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-26T00:00:00Z'
        AND  created  <  '2026-07-01T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 90000
        AND  valid = true
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = false
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-26T00:00:00Z'
        AND  created  <  '2026-07-01T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 90000
        AND  valid = true
    `);
  }

  async down(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-26T00:00:00Z'
        AND  created  <  '2026-07-01T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 90000
        AND  valid = false
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = true
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-26T00:00:00Z'
        AND  created  <  '2026-07-01T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 90000
        AND  valid = false
    `);
  }
};
