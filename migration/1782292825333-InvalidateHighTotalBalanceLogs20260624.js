// FinancialDataLog entries created on 2026-06-24 carry a totalBalanceChf that is
// implausibly high (> 80 000 CHF) compared to the expected operating-equity range,
// yet they were stamped valid=true. This is a recurrence of the same transient
// accounting spike handled for 2026-06-15 (see InvalidateHighTotalBalanceLogs
// 1781527084203), 2026-06-16 (see InvalidateHighTotalBalanceLogs 1781598468039),
// 2026-06-17 (see InvalidateHighTotalBalanceLogs 1781685299000), 2026-06-18
// (see InvalidateHighTotalBalanceLogs 1781766233000) and 2026-06-20 (see
// InvalidateHighTotalBalanceLogs 1781939033000): plusBalanceChf jumped ahead of the
// corresponding minusBalanceChf booking, so deltas at the elevated baseline stayed
// within financeLogTotalBalanceChangeLimit and the invalid flag was never set. This
// migration marks those entries invalid so monitoring dashboards and anomaly alerts
// reflect the period correctly.
//
// Threshold : totalBalanceChf > 80 000 (raised from the 60 000 used on the previous
//             days). The legitimate operating band has risen — on 2026-06-24, 450 of
//             512 entries sit in the 60 000–80 000 range, so the old 60 000 cut would
//             flag the normal band; 80 000 isolates the spike tail (59 rows above it,
//             peaking at ~358 939 CHF), of which 26 are still valid=true.
// Scope     : entries created on 2026-06-24 (UTC), no upper bound so every
//             affected row of the day is covered regardless of sub-second timing.
//
// Env-guarded: the COUNT pre-check makes up() a no-op where no rows match
// (staging/dev). down() re-stamps valid=true for the same window/threshold; it
// cannot distinguish rows already invalid before up() ran, so it may over-restore
// a small number of entries — accepted for this one-shot fix.
module.exports = class InvalidateHighTotalBalanceLogs1782292825333 {
  name = 'InvalidateHighTotalBalanceLogs1782292825333';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-24T00:00:00Z'
        AND  created  <  '2026-06-25T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 80000
        AND  valid = true
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = false
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-24T00:00:00Z'
        AND  created  <  '2026-06-25T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 80000
        AND  valid = true
    `);
  }

  async down(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-24T00:00:00Z'
        AND  created  <  '2026-06-25T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 80000
        AND  valid = false
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = true
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-24T00:00:00Z'
        AND  created  <  '2026-06-25T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 80000
        AND  valid = false
    `);
  }
};
