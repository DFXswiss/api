import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { CronLease } from '../cron-lease.entity';

/**
 * The table is created by a hand-written migration and read by hand-written SQL, so nothing in the
 * running application ever compares the entity against the schema. The next `npm run migration`
 * does, and it acts on what it finds: an entity that has drifted from the migration produces a
 * migration that "fixes" the difference — in the direction of the entity.
 *
 * So the entity is checked against the DDL directly, by building the metadata TypeORM would build
 * and asking its own driver and naming strategy what column definitions and constraint name that
 * yields. No connection is involved; the metadata is derived from the decorators alone.
 */
const MIGRATION = join(__dirname, '..', '..', '..', '..', '..', 'migration', '1785600000000-AddCronLease.js');

describe('CronLease entity', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: [CronLease] });

    // Builds the entity metadata without connecting to anything.
    await (dataSource as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
  });

  /** The `<name> <type> [NOT NULL] [DEFAULT ..]` fragment TypeORM would emit for each column. */
  function columnDefinitions(): string[] {
    const metadata = dataSource.getMetadata(CronLease);

    return metadata.columns.map((column) => {
      const type = dataSource.driver.normalizeType(column);
      const length = dataSource.driver.getColumnLength(column);
      const fallback = dataSource.driver.normalizeDefault(column);

      return [
        `"${column.databaseName}"`,
        length ? `${type}(${length})` : type.toUpperCase(),
        column.isNullable ? '' : 'NOT NULL',
        fallback ? `DEFAULT ${fallback}` : '',
      ]
        .filter(Boolean)
        .join(' ');
    });
  }

  it('maps to the table the migration creates', () => {
    expect(dataSource.getMetadata(CronLease).tableName).toEqual('cron_lease');
  });

  it('declares every column the migration declares, and no other', () => {
    const ddl = readFileSync(MIGRATION, 'utf8');

    for (const definition of columnDefinitions()) {
      expect(ddl).toContain(definition);
    }

    // The other direction: a column added to the table but not to the entity would be dropped by
    // the next generated migration, which the loop above cannot see.
    const created = /CREATE TABLE "cron_lease" \((.*?), CONSTRAINT/s.exec(ddl);

    expect(created).not.toBeNull();
    expect(created[1].split(/, (?=")/).length).toEqual(columnDefinitions().length);
  });

  it('gives the primary key the name the migration uses', () => {
    const metadata = dataSource.getMetadata(CronLease);
    const name = dataSource.namingStrategy.primaryKeyName(
      metadata.tableName,
      metadata.primaryColumns.map((column) => column.databaseName),
    );

    expect(name).toEqual('PK_a12c181c2b26f33be13d55a15af');
    expect(readFileSync(MIGRATION, 'utf8')).toContain(`CONSTRAINT "${name}" PRIMARY KEY ("name")`);
  });

  it('keeps both timestamps zone-aware', () => {
    // They are compared against now() in raw SQL. Without a zone the comparison runs through the
    // session time zone, and the lease expires an hour late or an hour early across a daylight
    // saving change — the first is a job that runs nowhere, the second is two processes running it.
    const metadata = dataSource.getMetadata(CronLease);

    for (const name of ['acquired', 'expires']) {
      const column = metadata.columns.find((c) => c.databaseName === name);

      expect(dataSource.driver.normalizeType(column)).toEqual('timestamp with time zone');
    }
  });
});
