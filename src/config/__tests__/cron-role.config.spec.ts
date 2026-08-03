import { Config, ConfigService, CronRole, GetConfig, parseCronRole } from '../config';

describe('parseCronRole', () => {
  it('accepts the three roles', () => {
    expect(parseCronRole('all')).toBe(CronRole.ALL);
    expect(parseCronRole('api')).toBe(CronRole.API);
    expect(parseCronRole('worker')).toBe(CronRole.WORKER);
  });

  it.each([undefined, '', ' ', 'All', 'WORKER', 'api ', 'true', 'none'])(
    'throws on %p instead of picking a role',
    (value) => {
      // Verifies that a missing, empty or unknown value is rejected rather than mapped to a
      // default: `parseCronRole` has no fallback branch, and the empty string takes the same path
      // as any other invalid value.
      expect(() => parseCronRole(value)).toThrow(/expected one of all, api, worker/);
    },
  );

  it('does not accept a scope value as a role', () => {
    // `both` is a property of a job, not an operating mode of a process. Accepting it here would
    // blur the two axes the split depends on.
    expect(() => parseCronRole('both')).toThrow();
  });
});

describe('Config.cronRole', () => {
  const original = process.env.CRON_ROLE;

  afterEach(() => {
    if (original == null) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = original;

    new ConfigService(GetConfig());
  });

  // Covers the wiring env -> parseCronRole -> Config that DfxCronService reads, which
  // unit-testing the parser alone would leave unverified.
  it.each([
    ['all', CronRole.ALL],
    ['api', CronRole.API],
    ['worker', CronRole.WORKER],
  ])('maps CRON_ROLE=%s to %s', (value, expected) => {
    process.env.CRON_ROLE = value;

    new ConfigService(GetConfig());

    expect(Config.cronRole).toBe(expected);
  });

  it('refuses to build a configuration without a role', () => {
    delete process.env.CRON_ROLE;

    expect(() => GetConfig()).toThrow(/expected one of all, api, worker/);
  });

  it('refuses to build a configuration from an invalid value', () => {
    process.env.CRON_ROLE = 'wroker';

    expect(() => GetConfig()).toThrow(/expected one of all, api, worker/);
  });
});
