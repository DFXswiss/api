import { ReadProjection } from 'src/shared/models/read-projection';
import { DataSource, EntityMetadata, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

/**
 * Test support for the read-path projections described in `docs/read-path-projections.md`.
 *
 * Needs a real database and skips without `MIGRATION_TEST_PG`, the gate the migration specs use.
 * The schema is built from the entity metadata, which is what a projection has to be complete
 * against.
 */

export const PROJECTION_TEST_PG = process.env.MIGRATION_TEST_PG;

/** `describe` when a database is configured, `describe.skip` otherwise. */
export const describeProjection = PROJECTION_TEST_PG ? describe : describe.skip;

/**
 * A data source over its own Postgres schema, with the schema created from the entity metadata.
 *
 * Every spec file passes its own schema name — Jest distributes spec files across workers, and two
 * of them writing the same tables would make the results depend on the scheduling.
 */
export async function createProjectionDataSource(schema: string): Promise<DataSource> {
  const bootstrap = new DataSource({ type: 'postgres', url: PROJECTION_TEST_PG, logging: false });
  await bootstrap.initialize();
  try {
    // Recreate rather than reuse: a schema left behind by an earlier run may predate the entities.
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    // Closed even when the schema could not be prepared: the caller never receives this instance,
    // so `afterAll` has nothing to close and the connection would outlive the run.
    await bootstrap.destroy();
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: PROJECTION_TEST_PG,
    schema,
    // Loaded as sources, so the spec sees the entities of the working tree rather than a stale build.
    entities: [__dirname + '/../../**/*.entity.ts'],
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  try {
    await dataSource.synchronize();
  } catch (e) {
    await dataSource.destroy();
    throw e;
  }

  return dataSource;
}

/** Drops the schema and closes the connection. Safe to call with `undefined`. */
export async function destroyProjectionDataSource(dataSource: DataSource | undefined, schema: string): Promise<void> {
  if (!dataSource?.isInitialized) return;
  await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await dataSource.destroy();
}

/** Which optional relations to populate, and with what. `true` means "populate with defaults". */
export interface SeedSpec {
  /**
   * Fixed column values. Anything not listed gets a generated one.
   *
   * Pin every column holding a TypeScript enum in a text column: the metadata reports it as
   * `varchar`, so the generated value is not a member and a mapper looking it up answers
   * `undefined` — indistinguishable from a missing column.
   */
  values?: ObjectLiteral;
  /** Optional relations to populate. Required ones are always populated. */
  relations?: Record<string, SeedSpec | true>;
}

// One counter for the whole process, so that generated numbers, dates and strings differ between
// rows — which is what keeps unique constraints satisfied when a spec seeds the same entity twice.
// A very short column is the limit: the counter is base-36 encoded and truncated to the declared
// length, so a `varchar(1)` repeats after 36 rows and such a column has to be pinned. Booleans and
// enums cannot be: a boolean has two values and an enum as many as it declares, so a spec that needs
// to tell two such columns apart pins them in the fixture. What every generated value is, is
// non-empty — which is what makes an empty field in a response proof that the query failed to load
// something.
let counter = 0;
const nextSeed = (): number => ++counter;

const BASE_DATE = new Date('2020-01-01T00:00:00.000Z').getTime();

function generatedValue(column: ColumnMetadata, seed: number): unknown {
  if (column.enum?.length) return column.enum[seed % column.enum.length];

  const type = typeof column.type === 'function' ? column.type.name.toLowerCase() : String(column.type).toLowerCase();

  if (['boolean', 'bool'].includes(type)) return true;
  if (['date', 'datetime', 'datetime2', 'timestamp', 'timestamptz', 'timestamp with time zone'].includes(type))
    return new Date(BASE_DATE + seed * 1000);
  if (
    [
      'number',
      'int',
      'int2',
      'int4',
      'int8',
      'integer',
      'smallint',
      'bigint',
      'float',
      'float4',
      'float8',
      'double precision',
      'real',
      'numeric',
      'decimal',
    ].includes(type)
  )
    return seed;
  if (['json', 'jsonb'].includes(type)) return { seed };

  // Everything else is treated as text. Two constraints pull in opposite directions here: the
  // declared length rejects anything longer (`country.symbol3` is varchar(3)), while uniqueness
  // requires the counter to survive the cut — truncating `symbol3-12` to three characters yields
  // "sym" for every row and the second insert fails on the unique index. So the counter is what
  // gets kept, base-36 encoded to fit more values into a short column, and the name fills whatever
  // room is left.
  const token = seed.toString(36);
  const text = `${column.propertyName}-${token}`;
  const length = Number(column.length);
  if (!(length > 0) || length >= text.length) return text;
  if (length <= token.length) return token.slice(-length);
  return column.propertyName.slice(0, length - token.length) + token;
}

function isPopulatable(column: ColumnMetadata): boolean {
  return (
    !column.isGenerated && !column.isCreateDate && !column.isUpdateDate && !column.isVersion && !column.relationMetadata
  );
}

/**
 * Assigns along a dotted path, creating the intermediate objects.
 *
 * Needed for embedded columns: their `propertyPath` is `address.address`, and writing that as one
 * flat key leaves a string where the ORM expects an object — it then fails with "cannot create
 * property 'address' on string" while flushing.
 */
function setPath(target: ObjectLiteral, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof current[part] !== 'object' || current[part] === null) current[part] = {};
    current = current[part] as ObjectLiteral;
  }
  current[parts[parts.length - 1]] = value;
}

/** Whether the caller pinned this column, by property name or by the full embedded path. */
function isPinned(spec: SeedSpec, column: ColumnMetadata): boolean {
  if (!spec.values) return false;
  if (column.propertyPath in spec.values || column.propertyName in spec.values) return true;
  const [root] = column.propertyPath.split('.');
  return root in spec.values;
}

/**
 * Inserts one row with a non-empty value in every column, creating required relations recursively.
 *
 * Generated from the metadata on purpose: a hand-written fixture that leaves a field empty makes
 * the completeness test green and the defect invisible.
 */
export async function seedEntity<E extends ObjectLiteral>(
  dataSource: DataSource,
  target: EntityTarget<E>,
  spec: SeedSpec = {},
): Promise<E> {
  const metadata = dataSource.getMetadata(target);
  const entity: ObjectLiteral = {};

  for (const relation of metadata.relations) {
    const requested = spec.relations?.[relation.propertyName];
    // Only owning to-one sides carry a foreign key on this row; the inverse sides are populated
    // from the other end and would recurse without end.
    if (!relation.isManyToOne && !(relation.isOneToOne && relation.isOwning)) continue;
    if (spec.values && relation.propertyName in spec.values) continue;
    const required = !relation.isNullable;
    if (!requested && !required) continue;
    entity[relation.propertyName] = await seedEntity(
      dataSource,
      relation.inverseEntityMetadata.target,
      requested === true || requested === undefined ? {} : requested,
    );
  }

  for (const column of metadata.columns) {
    if (!isPopulatable(column)) continue;
    if (isPinned(spec, column)) continue;
    setPath(entity, column.propertyPath, generatedValue(column, nextSeed()));
  }

  // Through `setPath` rather than `Object.assign`: `isPinned` accepts a full embedded path, and a
  // flat `'address.address'` key would leave the embedded field itself unset while suppressing the
  // generated value for it. A key without a dot is assigned exactly as before.
  for (const [key, value] of Object.entries(spec.values ?? {})) setPath(entity, key, value);

  return dataSource.getRepository(target).save(entity as E);
}

/**
 * Level 1 — with a fully populated fixture, no field of the response may be empty.
 *
 * `undefined`, `null`, `''` and `NaN` count as empty; `0` and `false` do not. `NaN` is on the list
 * because a field computed as `a + b + c` becomes `NaN` as soon as one column is missing.
 *
 * `optional` lists paths allowed to be empty for the fixture at hand. Covering those fields is the
 * job of another fixture, which this function does not track.
 */
export function expectNoEmptyFields(value: unknown, optional: string[] = [], path = ''): void {
  const empty =
    value === undefined || value === null || value === '' || (typeof value === 'number' && Number.isNaN(value));
  if (empty) {
    if (optional.includes(path)) return;
    throw new Error(`field '${path || '<root>'}' is empty — the query did not load it`);
  }
  if (Array.isArray(value)) {
    if (!value.length && !optional.includes(path)) throw new Error(`array '${path}' is empty`);
    value.forEach((item, index) => expectNoEmptyFields(item, optional, `${path}[${index}]`));
    return;
  }
  if (value instanceof Date || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as ObjectLiteral))
    expectNoEmptyFields(item, optional, path ? `${path}.${key}` : key);
}

/**
 * Passed to a mutation run to keep the projection whole — it matches no field name, so
 * `projectionFieldsWithout` returns the list unchanged. Used for the baseline run.
 */
export const NOTHING_OMITTED: string[] = [];

/** A projection's field list without the given field or fields. */
export function projectionFieldsWithout(fields: ReadonlyArray<string>, omitted: string | string[]): string[] {
  const drop = new Set(Array.isArray(omitted) ? omitted : [omitted]);
  return fields.filter((field) => !drop.has(field));
}

/**
 * Level 3 — removing any candidate from the projection must change the response.
 *
 * `run` receives the fields to leave out and returns what the production query answers without
 * them. The caller picks the candidates: which fields feed a response depends on the fixture, and
 * columns behind a fallback have to be dropped as a group.
 *
 * Compared against the full response rather than checked for emptiness — a missing column can
 * yield a valid-looking wrong value. Candidates whose removal changes nothing are reported by name.
 */
export async function expectEveryFieldRequired(
  candidates: ReadonlyArray<string | string[]>,
  run: (omitted: string | string[]) => Promise<unknown>,
  optional: string[] = [],
): Promise<void> {
  // Establish the baseline first. Without it this level passes vacuously: if the response is already
  // incomplete with the full field list — a fixture that leaves an enum at a value no mapper knows,
  // say — then every reduced run fails too, and "every field is required" would be reported for a
  // projection nothing was ever proven about. `NOTHING_OMITTED` matches no field name, so the caller
  // reduces by nothing and runs the query as production does.
  let baseline: unknown;
  try {
    baseline = await run(NOTHING_OMITTED);
    expectNoEmptyFields(baseline, optional);
  } catch (error) {
    throw new Error(
      `the response is already incomplete with the full projection, so dropping fields proves ` +
        `nothing — fix the fixture or the projection first. Cause: ${error.message ?? error}`,
    );
  }
  const reference = JSON.stringify(baseline);

  const survived: string[] = [];
  for (const candidate of candidates) {
    let unchanged = false;
    try {
      unchanged = JSON.stringify(await run(candidate)) === reference;
    } catch {
      // The query itself refused to run without the field — it carries weight, which is what this
      // level asserts.
    }
    if (unchanged) survived.push(Array.isArray(candidate) ? `[${candidate.join(' + ')}]` : candidate);
  }
  if (survived.length)
    throw new Error(
      `these fields can be dropped without changing the response: ${survived.join(', ')} — ` +
        `either they are not needed, or the fixture does not reach the branch that reads them`,
    );
}

/** Metadata helper: every column an entity would load without a projection. */
export function allColumnNames(metadata: EntityMetadata): string[] {
  return metadata.columns.map((column) => column.propertyName);
}

/**
 * Makes an incomplete projection fail loudly: reading a column the field list did not ask for
 * throws, naming it. See `docs/read-path-projections.md` for why.
 *
 * The decision comes from the field list, not from the row — this repository compiles to a target
 * where class fields are defined on the instance, so an unselected column and a selected `null`
 * look the same on the object.
 *
 * Joined relations are guarded against their own alias. Relations the projection does not join are
 * left alone; they are `undefined` and dereferencing them already throws. Getters pass through,
 * because reading through one is how the missing column is reached.
 */
export function guardProjection<E extends ObjectLiteral>(
  dataSource: DataSource,
  target: EntityTarget<E>,
  projection: GuardableProjection,
  fields: ReadonlyArray<string>,
  entity: E,
): E;
export function guardProjection<E extends ObjectLiteral>(
  dataSource: DataSource,
  target: EntityTarget<E>,
  projection: GuardableProjection,
  fields: ReadonlyArray<string>,
  entity: E[],
): E[];
export function guardProjection<E extends ObjectLiteral>(
  dataSource: DataSource,
  target: EntityTarget<E>,
  projection: GuardableProjection,
  fields: ReadonlyArray<string>,
  entity: E | E[] | null,
): E | E[] | null {
  if (entity == null) return entity;
  return guardAgainst(dataSource.getMetadata(target), projection, fields, entity) as E | E[];
}

/** The part of a `ReadProjection` the guard needs. */
export interface GuardableProjection {
  alias: string;
  joins: ReadonlyArray<readonly [string, string] | readonly [string, string, 'inner']>;
  guards: ReadonlyArray<string>;
}

function guardAgainst(
  rootMetadata: EntityMetadata,
  projection: GuardableProjection,
  fields: ReadonlyArray<string>,
  entity: unknown,
): unknown {
  if (entity == null) return entity;

  /**
   * What the query selected, per alias. Guards are selected too — `apply` adds them.
   *
   * The path after the alias is kept whole rather than split off at the first segment: an embedded
   * column is addressed as `alias.address.city`, and keeping only `address` would mark every
   * column of the embedded as selected.
   */
  const selected = new Map<string, Set<string>>();
  for (const field of [...fields, ...projection.guards]) {
    const [alias, ...path] = field.split('.');
    if (!selected.has(alias)) selected.set(alias, new Set());
    selected.get(alias).add(path.join('.'));
  }

  interface Node {
    metadata: EntityMetadata;
    asked: Set<string>;
    children: Map<string, Node>;
  }

  const node = (metadata: EntityMetadata, alias: string): Node => ({
    metadata,
    asked: selected.get(alias) ?? new Set(),
    children: new Map(),
  });

  const root = node(rootMetadata, projection.alias);
  const byAlias = new Map<string, Node>([[projection.alias, root]]);

  // `['parentAlias.relation', 'alias']`, in order — a later join may build on an earlier alias.
  for (const [path, alias] of projection.joins) {
    const [parentAlias, property] = path.split('.');
    const parent = byAlias.get(parentAlias);
    const relation = parent?.metadata.relations.find((r) => r.propertyName === property);
    if (!relation) continue;
    const child = node(relation.inverseEntityMetadata, alias);
    parent.children.set(property, child);
    byAlias.set(alias, child);
  }

  /** Is `path` an embedded object rather than a column — that is, does anything sit below it? */
  const isEmbedded = (at: Node, path: string): boolean =>
    at.metadata.columns.some((column) => column.propertyPath.startsWith(`${path}.`));

  /**
   * An embedded object, guarded one level down.
   *
   * Its columns are addressed by their full path (`address.city`), so the same selection set
   * answers for them; only the walk to reach them differs. `written` is the root's set and holds
   * the same full paths, so a value the caller assigned reads back here as it does on the root —
   * a fresh proxy is handed out on every access, and it would otherwise have nowhere to remember.
   */
  const wrapEmbedded = (value: ObjectLiteral, at: Node, prefix: string, written: Set<string>): ObjectLiteral =>
    value == null
      ? value
      : new Proxy(value, {
          set(source, property, assigned, receiver) {
            written.add(`${prefix}.${String(property)}`);
            return Reflect.set(source, property, assigned, receiver);
          },
          get(source, property, receiver) {
            const path = `${prefix}.${String(property)}`;
            const inner = Reflect.get(source, property, receiver);

            if (isEmbedded(at, path)) return wrapEmbedded(inner as ObjectLiteral, at, path, written);
            if (
              at.metadata.columns.some((column) => column.propertyPath === path) &&
              !at.asked.has(path) &&
              !written.has(path)
            ) {
              throw new Error(
                `read of '${at.metadata.name}.${path}', which this query did not select — ` +
                  `add it to the projection, or stop reading it`,
              );
            }

            return inner;
          },
        });

  /**
   * One proxy per source row and node.
   *
   * Wrapping on every access would hand out a new proxy each time, and two things break with it:
   * `row.relation === row.relation` is false, and each proxy starts with an empty set of caller
   * assignments, so writing through a relation and reading it back throws. Neither is a projection
   * defect, and a guard that invents them is measuring itself.
   */
  const proxies = new WeakMap<ObjectLiteral, Map<Node, unknown>>();

  const wrap = <T extends ObjectLiteral>(row: T | T[] | null, at: Node): T | T[] | null => {
    if (row == null) return row;
    if (Array.isArray(row)) return row.map((one) => wrap(one, at)) as T[];

    const known = proxies.get(row) ?? new Map<Node, unknown>();
    proxies.set(row, known);
    if (known.has(at)) return known.get(at) as T;

    // Properties the caller assigned itself. A projected read does not carry them, but writing one
    // and reading it back is what the write paths do — `createApiKey` sets the filter code on the
    // row before passing it to the update — and that is not a projection defect.
    const written = new Set<string>();

    const proxy = new Proxy(row, {
      set(source, property, value, receiver) {
        written.add(String(property));
        return Reflect.set(source, property, value, receiver);
      },
      get(source, property, receiver) {
        const name = String(property);
        const value = Reflect.get(source, property, receiver);

        const child = at.children.get(name);
        if (child) {
          // A relation joined for filtering only: with nothing of it selected the ORM never
          // materialises it, so the value is undefined whatever the row holds. That is not a row
          // without a relation — it is a question the query cannot answer, and reading it takes the
          // absent-relation branch silently.
          if (!child.asked.size && value == null && !written.has(name))
            throw new Error(
              `read of '${at.metadata.name}.${name}', a relation this query joins but selects nothing from — ` +
                `select at least its primary key, or stop reading it`,
            );

          return wrap(value, child);
        }

        const relation = at.metadata.relations.find((each) => each.propertyName === name);
        if (relation) {
          // Dereferencing an undeclared relation throws on its own, but `if (row.relation)` does
          // not dereference: it reads undefined, takes the absent branch and answers.
          //
          // Only eager relations are a projection defect. Those the unprojected query did load, so
          // failing to join one changes what the endpoint answers. A lazy relation was undefined
          // before the conversion too — reading it may well be a defect, but not one this change
          // introduced, and the guard would report the same thing on the code it replaced.
          //
          // Guarded on the value rather than the declaration, because TypeORM reports the
          // owner-side join column under the relation's own property name, and a query selecting
          // that column did fill it.
          if (relation.isEager && value == null && !at.asked.has(name) && !written.has(name))
            throw new Error(
              `read of '${at.metadata.name}.${name}', an eager relation this query does not join — ` +
                `the unprojected query carried it, so join it in the projection or stop reading it`,
            );

          return value;
        }

        // A `@RelationId` is filled from the foreign-key column of the row, which a query naming its
        // fields does not carry, and no field list can select it. Guarded on the value rather than
        // on the declaration: if it did arrive filled, reading it is not a defect.
        if (
          value === undefined &&
          at.metadata.relationIds.some((relationId) => relationId.propertyName === name) &&
          !written.has(name)
        ) {
          throw new Error(
            `read of '${at.metadata.name}.${name}', a @RelationId that a projected query never fills — ` +
              `join the relation and read the id off it`,
          );
        }

        if (isEmbedded(at, name)) return wrapEmbedded(value as ObjectLiteral, at, name, written);

        if (
          at.metadata.columns.some((column) => column.propertyPath === name) &&
          !at.asked.has(name) &&
          !written.has(name)
        ) {
          throw new Error(
            `read of '${at.metadata.name}.${name}', which this query did not select — ` +
              `add it to the projection, or stop reading it`,
          );
        }

        return value;
      },
    }) as T;

    known.set(at, proxy);

    return proxy;
  };

  return wrap(entity as ObjectLiteral, root);
}

/**
 * Turns the guard on for every query a `ReadProjection` builds, for the rest of the process.
 *
 * Installed once for the whole configuration rather than per spec, so that a spec added later is
 * covered by the same call. It applies to every projected query in the suite, including the ones
 * the mutation level runs with a reduced field list.
 */
export function installProjectionGuard(): void {
  const original = ReadProjection.prototype.apply;
  if ((original as { guarded?: boolean }).guarded) return;

  function guarded<E extends ObjectLiteral>(
    this: ReadProjection<E>,
    query: SelectQueryBuilder<E>,
    fields: ReadonlyArray<string> = this.fields,
  ): SelectQueryBuilder<E> {
    const built = original.call(this, query, fields) as SelectQueryBuilder<E>;
    const metadata = built.expressionMap.mainAlias?.metadata;
    if (!metadata) return built;

    const guard = (rows: unknown): unknown => guardAgainst(metadata, this, fields, rows);

    // `getRawAndEntities` is where `getOne`, `getMany` and `getOneOrFail` all hydrate, so guarding
    // it covers them and any direct caller in one place. `getManyAndCount` runs its own query and
    // needs its own hook. The raw methods return rows rather than entities and are left alone.
    const rawAndEntities = built.getRawAndEntities.bind(built);
    built.getRawAndEntities = async () => {
      const results = await rawAndEntities();
      return { ...results, entities: guard(results.entities) as E[] };
    };

    const manyAndCount = built.getManyAndCount.bind(built);
    built.getManyAndCount = async () => {
      const [rows, count] = await manyAndCount();
      return [guard(rows) as E[], count];
    };

    return built;
  }

  (guarded as { guarded?: boolean }).guarded = true;
  ReadProjection.prototype.apply = guarded as typeof ReadProjection.prototype.apply;
}
