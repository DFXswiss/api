// FinancialDataLog entries created on 2026-06-16 carry a totalBalanceChf that is
// implausibly high (> 50 000 CHF) compared to the expected operating-equity range,
// yet they were stamped valid=true. This is a recurrence of the same transient
// accounting spike handled for 2026-06-15 (see InvalidateHighTotalBalanceLogs
// 1781527084203): plusBalanceChf jumped ahead of the corresponding minusBalanceChf
// booking, so deltas at the elevated baseline stayed within
// financeLogTotalBalanceChangeLimit and the invalid flag was never set. This
// migration marks those entries invalid so monitoring dashboards and anomaly
// alerts reflect the period correctly.
//
// Threshold : totalBalanceChf > 50 000 (well above the normal ~20–30 k band)
// Scope     : entries created on 2026-06-16 (UTC), no upper bound so every
//             affected row of the day is covered regardless of sub-second timing.
//
// Env-guarded: the COUNT pre-check makes up() a no-op where no rows match
// (staging/dev). down() re-stamps valid=true for the same window/threshold; it
// cannot distinguish rows already invalid before up() ran, so it may over-restore
// a small number of entries — accepted for this one-shot fix.
module.exports = class InvalidateHighTotalBalanceLogs1781598468039 {
  name = 'InvalidateHighTotalBalanceLogs1781598468039';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-16T00:00:00Z'
        AND  created  <  '2026-06-17T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = true
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = false
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-16T00:00:00Z'
        AND  created  <  '2026-06-17T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = true
    `);
  }

  async down(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM log
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-16T00:00:00Z'
        AND  created  <  '2026-06-17T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = false
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE log SET valid = true
      WHERE  subsystem = 'FinancialDataLog'
        AND  created  >= '2026-06-16T00:00:00Z'
        AND  created  <  '2026-06-17T00:00:00Z'
        AND  (message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::numeric > 50000
        AND  valid = false
    `);
  }
};
