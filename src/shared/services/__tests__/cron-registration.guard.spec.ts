import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', '..');

/**
 * Periodic work registered outside DfxCronService is invisible to the scope mechanism: it runs
 * in every process, which for anything writing to the database or driving business forward means
 * running twice without a shared lock.
 *
 * The check is syntactic on purpose. It asks whether a pattern occurs, not whether the code
 * behind it is safe, so its exception list has a natural ceiling and every entry is a deliberate
 * decision rather than a special case.
 *
 * Its reach ends there, and that is worth stating: a timer built from a repeating setTimeout, an
 * aliased import or a scheduler reached through an object property passes unseen. Catching those
 * needs an AST-based rule rather than a text match. What this covers is the shape the four cases
 * in this repository actually had.
 *
 * The setTimeout gap is not hypothetical. ScryptService.scheduleCatchUpRetry,
 * ScryptWebSocketConnection.scheduleReconnect and CronLeaseService.keepAlive all re-arm themselves
 * and are invisible here. The lease renewal belongs to the lifetime of a single job run rather
 * than to a schedule, and routing it through @DfxCron would be circular — it is the mechanism that
 * keeps @DfxCron jobs from running in two processes at once. The Scrypt two are deliberately left
 * alone as well: their state is the process-local cache and socket of the process
 * they run in, and a request path reaches them (ExchangeController injects ExchangeRegistryService
 * and ExchangeTxService), so both processes need their own. Binding them to a role would break the
 * exchange endpoints on the API process. Anyone extending this check should read that case first —
 * "the check does not see it" and "it must not be scoped" are two different statements.
 */
const FORBIDDEN: { pattern: RegExp; what: string; instead: string }[] = [
  {
    pattern: /@Cron\(/,
    what: 'the native @Cron decorator',
    instead: 'use @DfxCron, which applies the scope, the process flag and the lock',
  },
  {
    pattern: /@Interval\(|@Timeout\(/,
    what: 'the @Interval or @Timeout decorator',
    instead: 'use @DfxCron - these register with the same scheduler and are equally invisible to the scope',
  },
  {
    pattern: /\bsetInterval\(/,
    what: 'a bare setInterval',
    instead: 'use @DfxCron, or bind the timer to Config.cronRole where a scheduler cannot reach it',
  },
];

/** Timers tied to the lifetime of something other than a schedule. */
const ALLOWED: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) return [];

    return [path];
  });
}

describe('cron registration', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(SRC, path).split('\\').join('/'),
    content: readFileSync(path, 'utf8'),
  }));

  it('finds source files to check', () => {
    // Guards against the check passing because the traversal returned nothing.
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN)('registers no periodic work through $what — $instead', ({ pattern }) => {
    const offenders = files.filter((f) => !ALLOWED.includes(f.path) && pattern.test(f.content)).map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it('keeps the exception list honest', () => {
    // An exception that no longer matches anything is a leftover, and the next reader would take
    // it for a rule that still applies.
    for (const allowed of ALLOWED) {
      const file = files.find((f) => f.path === allowed);

      expect(file).toBeDefined();
      expect(FORBIDDEN.some((f) => f.pattern.test(file.content))).toBe(true);
    }
  });
});
