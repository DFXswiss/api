import { Process } from 'src/shared/services/process.service';
import { GetConfig } from '../config';

// Ledger `Process` values, derived from the enum's OWN key names (never hardcoded), the same way the
// config derives them — a future `Process.LEDGER_*` entry is covered here without an edit to this file.
const LEDGER_PROCESSES = (Object.keys(Process) as (keyof typeof Process)[])
  .filter((k) => k.startsWith('LEDGER'))
  .map((k) => Process[k]);

describe('Ledger master switch → disabled processes', () => {
  const envBackup = process.env.DISABLED_PROCESSES;

  afterEach(() => {
    if (envBackup == null) delete process.env.DISABLED_PROCESSES;
    else process.env.DISABLED_PROCESSES = envBackup;
  });

  // Sanity: an empty or undersized derivation would make every assertion below vacuously pass.
  it('derives at least the 13 known ledger processes', () => {
    expect(LEDGER_PROCESSES.length).toBeGreaterThanOrEqual(13);
  });

  it('disables every ledger process while the master switch is off', () => {
    // The point of routing the switch through here: `skipWhenDisabled` runs OUTSIDE the cron lease, so
    // the ledger jobs stop taking part in cron at all instead of claiming a lease every minute only to
    // return from the in-body guard. Checking the job bodies cannot show this — the lease is claimed
    // before the body runs.
    delete process.env.DISABLED_PROCESSES;

    const config = GetConfig();
    config.ledger.enabled = false;

    expect(config.disabledProcesses()).toEqual(expect.arrayContaining(LEDGER_PROCESSES));
  });

  it('leaves the ledger processes enabled once the master switch is on', () => {
    // Nothing is pinned off permanently: with the switch on, the ledger processes are governed by the
    // `disabledProcess` setting alone, exactly like every other process.
    delete process.env.DISABLED_PROCESSES;

    const config = GetConfig();
    config.ledger.enabled = true;

    expect(config.disabledProcesses()).toEqual([]);
  });

  it('adds to DISABLED_PROCESSES rather than replacing it', () => {
    process.env.DISABLED_PROCESSES = Process.BUY_CRYPTO;

    const config = GetConfig();
    config.ledger.enabled = false;

    const disabled = config.disabledProcesses();

    expect(disabled).toContain(Process.BUY_CRYPTO);
    expect(disabled).toEqual(expect.arrayContaining(LEDGER_PROCESSES));
  });

  it('still disables everything under the DISABLED_PROCESSES wildcard', () => {
    process.env.DISABLED_PROCESSES = '*';

    const config = GetConfig();
    config.ledger.enabled = true;

    expect(config.disabledProcesses()).toEqual(Object.values(Process));
  });
});
