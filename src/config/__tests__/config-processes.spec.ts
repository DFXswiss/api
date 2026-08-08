import { Config, ConfigService, CronRole, Configuration, GetConfig, parseCronRole } from 'src/config/config';
import { Process } from 'src/shared/services/process.service';

const LEDGER_PROCESSES = (Object.keys(Process) as (keyof typeof Process)[])
  .filter((k) => k.startsWith('LEDGER_'))
  .map((k) => Process[k]);

describe('Config.disabledProcesses', () => {
  const backup = process.env.DISABLED_PROCESSES;

  afterEach(() => {
    if (backup === undefined) delete process.env.DISABLED_PROCESSES;
    else process.env.DISABLED_PROCESSES = backup;
  });

  // Sanity: an empty derivation would make the ledger assertions below pass vacuously.
  it('derives the ledger processes from the Process enum key names', () => {
    expect(LEDGER_PROCESSES.length).toBeGreaterThanOrEqual(13);
  });

  it('disables nothing beyond DISABLED_PROCESSES while the ledger master switch is on', () => {
    delete process.env.DISABLED_PROCESSES;
    const config = GetConfig();
    config.ledger.enabled = true;

    expect(config.disabledProcesses()).toEqual([]);
  });

  // The switch reaches its jobs through this list, which is evaluated OUTSIDE the cron lease — a
  // switched-off ledger job must drop out of cron entirely instead of claiming a lease every
  // minute only to return from its in-body guard.
  it('adds every ledger process to the list while the master switch is off', () => {
    delete process.env.DISABLED_PROCESSES;
    const config = GetConfig();
    config.ledger.enabled = false;

    expect(config.disabledProcesses()).toEqual(LEDGER_PROCESSES);
  });

  it('extends DISABLED_PROCESSES instead of replacing it', () => {
    process.env.DISABLED_PROCESSES = `${Process.BUY_CRYPTO},${Process.BUY_FIAT}`;
    const config = GetConfig();
    config.ledger.enabled = false;

    expect(config.disabledProcesses()).toEqual([Process.BUY_CRYPTO, Process.BUY_FIAT, ...LEDGER_PROCESSES]);
  });

  it('disables every known process under the wildcard', () => {
    process.env.DISABLED_PROCESSES = '*';
    const config = GetConfig();
    config.ledger.enabled = true;

    expect(config.disabledProcesses()).toEqual(Object.values(Process));
  });
});

describe('Config.cronRole', () => {
  const backup = process.env.CRON_ROLE;

  afterEach(() => {
    if (backup === undefined) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = backup;
  });

  it('maps every role value', () => {
    expect(parseCronRole('all')).toBe(CronRole.ALL);
    expect(parseCronRole('api')).toBe(CronRole.API);
    expect(parseCronRole('worker')).toBe(CronRole.WORKER);
  });

  // Every conceivable default lets a misconfiguration run silently — duplicated execution of
  // financial jobs or a worker that does nothing — so the boot has to fail instead.
  it.each([undefined, '', 'ALL', 'both'])('rejects %p rather than picking a default', (value) => {
    expect(() => parseCronRole(value)).toThrow(/expected one of all, api, worker/);
  });

  it('reads the role of the running process from CRON_ROLE', () => {
    process.env.CRON_ROLE = 'worker';

    expect(GetConfig().cronRole).toBe(CronRole.WORKER);
  });

  it('refuses to build a configuration without a valid role', () => {
    delete process.env.CRON_ROLE;

    expect(() => GetConfig()).toThrow(/expected one of all, api, worker/);
  });
});

describe('ConfigService', () => {
  // The exported `Config` singleton is published by the ConfigService constructor — nothing else
  // assigns it, which is what the bootstrap-ordering guard depends on.
  it('is undefined until a ConfigService is constructed', () => {
    expect(Config).toBeUndefined();
  });

  it('publishes a self-built configuration when none is injected', () => {
    new ConfigService();

    expect(Config).toBeInstanceOf(Configuration);
  });

  it('publishes the injected configuration unchanged', () => {
    const injected = GetConfig();

    new ConfigService(injected);

    expect(Config).toBe(injected);
  });
});
