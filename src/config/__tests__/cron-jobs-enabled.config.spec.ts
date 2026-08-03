import { parseCronJobsEnabled } from '../config';

describe('parseCronJobsEnabled', () => {
  it('defaults to enabled when unset, so existing environments keep running jobs', () => {
    expect(parseCronJobsEnabled(undefined)).toBe(true);
    expect(parseCronJobsEnabled('')).toBe(true);
  });

  it('accepts the two valid values', () => {
    expect(parseCronJobsEnabled('true')).toBe(true);
    expect(parseCronJobsEnabled('false')).toBe(false);
  });

  it.each(['fals', 'False', 'FALSE', '0', 'no', 'off', 'disabled', ' false'])(
    'throws on %p instead of silently enabling the scheduler',
    (value) => {
      // The dangerous direction is a typo being read as "enabled": on an instance meant to be
      // HTTP-only that would re-register every job, and jobs without a `process` (trades,
      // referral credits, volume resets) would then run on two instances at once. Cron locks
      // are per-process, so nothing else would catch it. Failing the boot is the safe outcome.
      expect(() => parseCronJobsEnabled(value)).toThrow(/expected 'true' or 'false'/);
    },
  );
});
