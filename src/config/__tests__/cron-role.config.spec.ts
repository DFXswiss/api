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
      // Every possible default is silent in one direction: 'worker' would make a misconfigured
      // API process run all background work a second time, 'api' would make a misconfigured
      // worker do nothing at all. Neither raises an error, and duplicate execution of financial
      // jobs is worse than a failed boot. The empty string is included deliberately — a
      // `CRON_ROLE=` line or an unresolved `${VAR}` is the likeliest accident of all.
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
