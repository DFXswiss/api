import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', '..');

/**
 * Periodic work registered outside DfxCronService is invisible to the scope mechanism: it runs
 * in every process, which for anything writing to the database or driving business forward means
 * running twice without a shared lock. Two native @Cron decorators and one bare setInterval had
 * grown that way before the mechanism existed, and nothing would have flagged the next one.
 *
 * The check is syntactic on purpose. It asks whether a pattern occurs, not whether the code
 * behind it is safe, so its exception list has a natural ceiling and every entry is a deliberate
 * decision rather than a special case.
 */
const FORBIDDEN: { pattern: RegExp; what: string; instead: string }[] = [
  {
    pattern: /@Cron\(/,
    what: 'the native @Cron decorator',
    instead: 'use @DfxCron, which applies the scope, the process flag and the lock',
  },
  {
    pattern: /\bsetInterval\(/,
    what: 'a bare setInterval',
    instead: 'use @DfxCron, or bind the timer to Config.cronRole where a scheduler cannot reach it',
  },
];

/**
 * A timer tied to the lifetime of an object rather than to a schedule. It is bound to the role
 * directly, which is the same decision the scope expresses for a cron job.
 */
const ALLOWED = ['integration/blockchain/spark/spark-client.ts'];

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
