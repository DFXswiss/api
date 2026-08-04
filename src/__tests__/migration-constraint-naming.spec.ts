import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Hand-written schema migrations must name their constraints the way TypeORM does. CONTRIBUTING.md
 * states the rule and the algorithm; this checks that the files obey it.
 *
 * It is not a style question. A constraint TypeORM does not recognise as its own is one it offers
 * to create — a schema comparison sees a name it would never have produced, reports the constraint
 * as missing, and a generated migration or a `synchronize` run acts on that.
 *
 * Two checks, deliberately: the recomputation covers the primary keys declared inside a
 * `CREATE TABLE`, where table and columns are both in front of us, and the shape check covers
 * every other constraint kind, where they are not. The shape check is the weaker statement — a
 * hexadecimal name can still be the wrong hexadecimal name — but it catches the case this guard
 * was written for, a name assembled out of words.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'migration');

/** From CONTRIBUTING.md: `<prefix>_ + sha1(tableName + '_' + columnNames.sort().join('_'))`. */
function typeormName(prefix: string, length: number, table: string, columns: string[]): string {
  return `${prefix}_${createHash('sha1')
    .update(`${table}_${[...columns].sort().join('_')}`)
    .digest('hex')
    .substring(0, length)}`;
}

interface Migration {
  file: string;
  content: string;
}

describe('migration constraint naming', () => {
  const migrations: Migration[] = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, content: readFileSync(join(MIGRATIONS, file), 'utf8') }));

  it('finds the migrations to check', () => {
    // Guards against the whole suite passing because the directory was read from the wrong place.
    expect(migrations.length).toBeGreaterThan(50);
  });

  describe('primary keys declared in a CREATE TABLE', () => {
    const declared = migrations.flatMap(({ file, content }) =>
      [...content.matchAll(/CREATE TABLE "(\w+)" \((?:.*?)CONSTRAINT "(PK_\w+)" PRIMARY KEY \(([^)]*)\)/gs)].map(
        ([, table, name, columns]) => ({
          file,
          table,
          name,
          columns: columns.split(',').map((column) => column.trim().replace(/"/g, '')),
        }),
      ),
    );

    it('finds primary keys to check', () => {
      expect(declared.length).toBeGreaterThan(50);
    });

    it('names every one of them the way TypeORM would', () => {
      const wrong = declared
        .filter(({ table, name, columns }) => name !== typeormName('PK', 27, table, columns))
        .map(({ file, table, name, columns }) => ({
          file,
          name,
          expected: typeormName('PK', 27, table, columns),
        }));

      expect(wrong).toEqual([]);
    });
  });

  it('gives every constraint a hashed name rather than a spelled-out one', () => {
    // The shape the algorithm produces: a prefix and hexadecimal. A name built from the table and
    // column it belongs to reads correctly and is exactly the case this catches.
    const spelledOut = migrations.flatMap(({ file, content }) =>
      [...content.matchAll(/CONSTRAINT "((?:PK|FK|UQ|DF|REL|IDX|CHK)_\w+)"/g)]
        .map(([, name]) => ({ file, name }))
        .filter(({ name }) => !/^(?:PK|FK|UQ|DF|REL|IDX|CHK)_[a-f0-9]+$/.test(name)),
    );

    expect(spelledOut).toEqual([]);
  });
});
