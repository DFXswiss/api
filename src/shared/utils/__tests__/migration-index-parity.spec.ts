import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityMetadata, getMetadataArgsStorage } from 'typeorm';

// Migrations create indexes in raw SQL; entities declare them with @Index. When the two disagree the
// database silently loses the index: RdbmsSchemaBuilder.dropOldIndices drops any database index whose
// name has no entry in the entity metadata, and also drops one whose column set or uniqueness differs,
// recreating it from the (wrong) declaration. A schema-generation run then undoes the migration.
//
// This spec sweeps EVERY migration rather than a curated list — a hardcoded list silently stops
// covering each new index migration, which is exactly how this drift got in. Expectations are read out
// of the migration SQL and compared against REAL TypeORM EntityMetadata (resolved index names and
// column databaseNames), not re-derived from the declaration, so the comparison is independent of how
// a decorator happens to be written and sees through relations, inherited columns and name overrides.
const MIGRATION_DIR = join(__dirname, '../../../../migration');

// Indexes deliberately owned by their migration, which must NOT be declared on an entity. Every entry
// needs a reason, because each one is a hole in the guarantee above.
const MIGRATION_OWNED: Record<string, string> = {
  // Covering index — TypeORM cannot express INCLUDE. Declaring the key columns alone would make schema
  // generation drop it (Postgres counts INCLUDE columns in pg_index.indkey, so the column count would
  // not match) and recreate it without the INCLUDE, losing the index-only scan it exists for.
  IDX_b7eda1156aca7b2a1302cdf88f: 'log covering index with INCLUDE',
};

// Drift that already exists on develop and predates this spec: the entity declares these columns but
// TypeORM generates a different index name for them, so the migration's index is orphaned rather than
// merely missing, and schema generation drops it. Enumerated rather than fixed here so this spec can
// guard against NEW drift immediately; correcting them belongs to the owning subdomain.
const PRE_EXISTING_DRIFT: Record<string, string> = {
  IDX_b2192a6137c2bf4227da3fad6f: 'virtual_iban_issuance_intent (userDataId, currencyId, bankId)',
  IDX_a2bc742d45eed31bb95b7ae704: 'virtual_iban_issuance_intent (buyId, currencyId, bankId)',
  IDX_d13a086240fde776387b9a5ee7: 'virtual_iban_issuance_intent (buyId)',
};

// Custom-named migration indexes. With one exception these are NOT inexpressible — TypeORM's
// @Index(name, columns, options) would declare every one of them, partial `where` included (the repo
// already does that in user.entity.ts). They are exempt because declaring them would require passing
// the migration's custom name, and CONTRIBUTING.md:100/630 forbids custom index names on entities.
// So the drift is real but unfixable without renaming the index in a migration first; that is a
// deliberate deferral, not an impossibility.
//
// A custom name alone is not proof of migration ownership: `ibanBic` and `oneRewardPerRouteCheck`
// carry custom names AND entity declarations, and are checked normally.
const CUSTOM_NAMED_MIGRATION_OWNED: Record<string, string> = {
  // The only genuinely inexpressible one: TypeORM cannot declare an index on an expression.
  IDX_user_data_mail_lower: 'expression index on LOWER(mail)',
  IDX_user_open_ref_credit: 'custom name — declarable only by renaming the index in a migration',
  IDX_liquidity_order_inflight_purchase: 'custom name — declarable only by renaming the index in a migration',
  IDX_bank_tx_type_created: 'custom name — declarable only by renaming the index in a migration',
  IDX_log_financial_query: 'custom name — declarable only by renaming the index in a migration',
  IDX_scorechain_screening_lookup: 'custom name — declarable only by renaming the index in a migration',
  IDX_scorechain_screening_created: 'custom name — declarable only by renaming the index in a migration',
};

const EXEMPT: Record<string, string> = {
  ...MIGRATION_OWNED,
  ...PRE_EXISTING_DRIFT,
  ...CUSTOM_NAMED_MIGRATION_OWNED,
};

interface SqlIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  migration: string;
}

// Every CREATE INDEX spelling these migrations could plausibly use: optional UNIQUE / CONCURRENTLY /
// IF NOT EXISTS, optional schema qualification, optional USING <method>, identifiers quoted or bare.
// INCLUDE columns fall outside the captured parens by construction — they are not key columns.
const CREATE_INDEX =
  /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:ONLY\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi;
const DROP_INDEX = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi;

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const readMigrations = (): { created: SqlIndex[]; dropped: Set<string> } => {
  const created: SqlIndex[] = [];
  const dropped = new Set<string>();

  for (const file of readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()) {
    const source = stripComments(readFileSync(join(MIGRATION_DIR, file), 'utf8'));
    // Only up() is considered: down() exists to undo up(), so counting its DROP statements would
    // cancel out every index the migration just created.
    const downAt = source.indexOf('async down');
    const up = downAt === -1 ? source : source.slice(0, downAt);

    // Applied in SOURCE ORDER, not all-creates-then-all-drops: migration:generate emits DROP followed
    // by CREATE whenever an index definition changes, and processing the drop last would leave that
    // index permanently marked dropped and silently outside this spec's coverage.
    const statements: { at: number; create?: RegExpExecArray; drop?: string }[] = [
      ...[...up.matchAll(CREATE_INDEX)].map((m) => ({ at: m.index ?? 0, create: m })),
      ...[...up.matchAll(DROP_INDEX)].map((m) => ({ at: m.index ?? 0, drop: m[1] })),
    ].sort((a, b) => a.at - b.at);

    for (const statement of statements) {
      if (statement.drop) {
        dropped.add(statement.drop);
        continue;
      }

      const [, unique, name, table, columns] = statement.create!;
      dropped.delete(name);
      created.push({
        name,
        table,
        unique: unique != null,
        migration: file,
        columns: columns.split(',').map((c) => c.trim().replace(/"/g, '')),
      });
    }
  }

  return { created, dropped };
};

describe('migration index parity (entity @Index declarations vs. migration CREATE INDEX)', () => {
  let live: SqlIndex[];
  let byTable: Map<string, EntityMetadata>;
  // Every entity class to its table, single-table-inheritance children included.
  let tableOfTarget: Map<unknown, string>;

  beforeAll(async () => {
    const { created, dropped } = readMigrations();
    // Last definition wins; an index dropped by a later migration and never recreated is expected on
    // no entity.
    const latest = new Map(created.map((i) => [i.name, i]));
    live = [...latest.values()].filter((i) => !dropped.has(i.name));

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (entry.name.endsWith('.entity.ts')) out.push(path);
      }
      return out;
    };

    for (const file of walk(join(__dirname, '../../..'))) {
      // Loading every entity is what registers the decorators; the same glob config.ts uses.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(file);
    }

    const targets = getMetadataArgsStorage()
      .tables.map((t) => t.target)
      .filter((t) => typeof t === 'function');
    const dataSource = new DataSource({ type: 'postgres', entities: targets as never[] });
    // buildMetadatas populates entityMetadatas before validating, and validation throws on an
    // unrelated entity whose column type ts-jest cannot reflect — irrelevant to index shape.
    await (dataSource as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas().catch(() => undefined);

    // Single-table inheritance gives one table several EntityMetadata (deposit_route has four,
    // kyc_log nine). RdbmsSchemaBuilder.entityToSyncMetadatas filters out `entity-child`, so only the
    // non-child metadata is ever synced — and it is the one that carries the merged index set. Keying
    // last-wins on tableName would pick an arbitrary leaf child instead, whose .indices omit its
    // parent's and siblings', making correct declarations read as missing.
    byTable = new Map(
      dataSource.entityMetadatas.filter((m) => m.tableType !== 'entity-child').map((m) => [m.tableName, m]),
    );
    tableOfTarget = new Map(dataSource.entityMetadatas.map((m) => [m.target, m.tableName]));
  });

  const declaredFor = (index: SqlIndex): EntityMetadata['indices'][number] | undefined =>
    byTable.get(index.table)?.indices.find((m) => m.name === index.name);

  it('sweeps the migration directory and builds entity metadata', () => {
    // Guards both inputs: a regex or a metadata build that silently yielded nothing would make every
    // assertion below vacuous, since they all iterate these sets.
    expect(live.length).toBeGreaterThan(100);
    expect(byTable.size).toBeGreaterThan(50);
  });

  it('declares every migration-created index on its entity', () => {
    const undeclared = live
      .filter((i) => !EXEMPT[i.name])
      // A table with no entity at all is never visited by schema generation.
      .filter((i) => byTable.has(i.table) && !declaredFor(i))
      .map((i) => `${i.name} on ${i.table} (${i.columns.join(', ')}) from ${i.migration}`);

    expect(undeclared).toEqual([]);
  });

  it('matches the column order and database names the migrations used', () => {
    const mismatched = live.flatMap((i) => {
      const declared = declaredFor(i);
      if (!declared) return [];

      const actual = declared.columns.map((c) => c.databaseName);

      return actual.join() === i.columns.join() ? [] : [{ index: i.name, table: i.table, expected: i.columns, actual }];
    });

    expect(mismatched).toEqual([]);
  });

  it('matches the uniqueness the migrations declared', () => {
    const mismatched = live.flatMap((i) => {
      const declared = declaredFor(i);

      return declared && declared.isUnique !== i.unique
        ? [{ index: i.name, table: i.table, expected: i.unique, actual: declared.isUnique }]
        : [];
    });

    expect(mismatched).toEqual([]);
  });

  it('keeps every declared index visible to schema generation', () => {
    // Read from the decorator args, not the built metadata: `synchronize: false` makes
    // IndexMetadata.build() return early leaving `name` undefined, so such an index can never be
    // found by name — checking it via declaredFor would be dead code. spatial/fulltext keep their
    // name but change the comparison dropOldIndices makes, forcing a drop-and-recreate.
    const indexedTables = new Set(live.map((i) => i.table));

    const hidden = getMetadataArgsStorage()
      .indices.filter((i) => i.synchronize === false || i.spatial || i.fulltext)
      // Resolved from ALL metadata, children included: an STI child writes into its parent's table,
      // so a hidden index declared on a child would otherwise escape this check entirely.
      .filter((i) => indexedTables.has(tableOfTarget.get(i.target) ?? ''))
      .map((i) => {
        // i.columns is the raw lambda for the dominant declaration style, so stringifying it yields
        // "undefined". Resolve it to property names so the message localises the offending index.
        const columns =
          typeof i.columns === 'function'
            ? (i.columns as (o: unknown) => unknown[])(new Proxy({}, { get: (_t, p) => p })).map(String)
            : i.columns;

        return `${(i.target as { name: string }).name}: [${columns}]`;
      });

    expect(hidden).toEqual([]);
  });

  it('keeps every exemption live, justified and unresolved', () => {
    // Each exemption is a hole in the guarantee, so none may be added silently, and one naming an
    // index that no longer exists would mask a real regression. The resolved check makes the
    // pre-existing drift list self-retiring: declare one of those indexes and its entry must go.
    const stale = Object.keys(EXEMPT).filter((name) => !live.some((i) => i.name === name));
    const resolved = Object.keys(EXEMPT).filter((name) => live.some((i) => i.name === name && declaredFor(i)));

    expect(stale).toEqual([]);
    expect(resolved).toEqual([]);
    expect(Object.values(EXEMPT).filter((reason) => !reason)).toEqual([]);
  });
});
