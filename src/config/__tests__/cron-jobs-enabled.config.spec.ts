import { Config, ConfigService, GetConfig, parseCronJobsEnabled } from '../config';

describe('parseCronJobsEnabled', () => {
  it('defaults to enabled when the variable is absent, so existing environments keep running jobs', () => {
    expect(parseCronJobsEnabled(undefined)).toBe(true);
  });

  it('accepts the two valid values', () => {
    expect(parseCronJobsEnabled('true')).toBe(true);
    expect(parseCronJobsEnabled('false')).toBe(false);
  });

  it.each(['', ' ', 'fals', 'False', 'FALSE', '0', 'no', 'off', 'disabled', ' false'])(
    'throws on %p instead of silently enabling the scheduler',
    (value) => {
      // The dangerous direction is a value being read as "enabled": on an instance meant to be
      // HTTP-only that re-registers every job, and jobs without a `process` (trades, referral
      // credits, volume resets) would then run on two instances at once. Cron locks are
      // per-process, so nothing else would catch it. Failing the boot is the safe outcome.
      // The empty string is included deliberately — an `CRON_JOBS_ENABLED=` line or an
      // unresolved `${VAR}` is the likeliest accident of all.
      expect(() => parseCronJobsEnabled(value)).toThrow(/expected 'true' or 'false'/);
    },
  );
});

describe('Config.cronJobsEnabled', () => {
  const original = process.env.CRON_JOBS_ENABLED;

  afterEach(() => {
    if (original == null) delete process.env.CRON_JOBS_ENABLED;
    else process.env.CRON_JOBS_ENABLED = original;

    new ConfigService(GetConfig());
  });

  // Covers the wiring env -> parseCronJobsEnabled -> Config that DfxCronService reads,
  // which unit-testing the parser alone would leave unverified.
  it.each([
    ['false', false],
    ['true', true],
  ])('maps CRON_JOBS_ENABLED=%s to %s', (value, expected) => {
    process.env.CRON_JOBS_ENABLED = value;

    new ConfigService(GetConfig());

    expect(Config.cronJobsEnabled).toBe(expected);
  });

  it('runs jobs when the variable is absent', () => {
    delete process.env.CRON_JOBS_ENABLED;

    new ConfigService(GetConfig());

    expect(Config.cronJobsEnabled).toBe(true);
  });

  it('refuses to build a configuration from an invalid value', () => {
    process.env.CRON_JOBS_ENABLED = 'fals';

    expect(() => GetConfig()).toThrow(/expected 'true' or 'false'/);
  });
});
