import { DataSource, EntityMetadata, EntityTarget, ObjectLiteral } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

/**
 * Test support for the read-path projections described in `docs/read-path-projections.md`.
 *
 * All of it needs a real database. A mocked repository returns whatever the mock defines and cannot
 * observe which columns were requested, so it can test none of the four levels — which is why the
 * suite skips when `MIGRATION_TEST_PG` is unset, the same gate the migration specs use.
 *
 * The schema comes from the entity metadata via `synchronize`, not from replayed migrations: the
 * reference a projection has to be complete against is the entity definition.
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
  // Recreate rather than reuse: a schema left behind by an earlier run may predate the entities.
  await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  await bootstrap.destroy();

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
  await dataSource.synchronize();
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
   * Needed for every column that holds a TypeScript enum in a plain text column — most of them in
   * this schema. The metadata reports those as `varchar`, so the generator produces a distinct
   * string that is not a member of the enum, and a mapper looking the value up (`PaymentStatusMapper[…]`,
   * `txExplorerUrl(blockchain, …)`) answers `undefined`. That reads exactly like a missing column,
   * which is why the completeness assertion catches it — set the value here instead, and cover the
   * other members as level-2 variants.
   */
  values?: ObjectLiteral;
  /** Optional relations to populate. Required ones are always populated. */
  relations?: Record<string, SeedSpec | true>;
}

// One counter for the whole process. Every generated value is distinct, which is what makes an
// empty field in a response proof that the query failed to load something — and it keeps unique
// constraints satisfied when a spec seeds the same entity twice.
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
 * Inserts one row with a distinct value in every column, creating required relations recursively.
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

  Object.assign(entity, spec.values ?? {});
  return dataSource.getRepository(target).save(entity as E);
}

/**
 * Level 1 — with a fully populated fixture, no field of the response may be empty.
 *
 * Walks nested objects and arrays. `undefined`, `null`, `''` and `NaN` count as empty; `0` and
 * `false` do not, because they are legitimate values a projection can load correctly.
 *
 * `NaN` belongs on that list even though nothing produces it directly: a DTO field computed as
 * `a + b + c` from three columns turns into `NaN` the moment one of them is missing. It is not
 * absent, so a plain `undefined` check waves it through — and it is exactly the silent wrong value
 * this whole exercise is meant to catch. The annual volume on the support view is such a field.
 *
 * `optional` lists paths that are allowed to be empty for the fixture at hand — a field the DTO
 * only fills for one branch. Every entry is a statement that the *other* branch covers it, which is
 * what level 2 is for, so keep the list short and cover the counterpart.
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
 * Level 3 — removing any candidate from the projection must break level 1.
 *
 * `run` receives the fields to leave out, runs the same production query without them and returns
 * the response. The caller does the reducing, because which fields feed the response can depend on
 * the fixture: `UserData.address` reads the organization's address for a business account and the
 * account's own for a personal one, so each variant asserts over its own set of candidates while the
 * rest of the projection stays in the query.
 *
 * **A candidate may be a group of fields, and sometimes has to be.** Where several columns feed one
 * response value through a fallback — `organizationName ?? firstname + surname` — no single one of
 * them is required: drop any one and the next alternative fills the value. Asserting them
 * individually would report every one of them as removable, which is true and useless. The group is
 * what carries the value, so the group is what gets dropped.
 *
 * A candidate whose removal changes nothing is either unnecessary or a gap in the fixture; both need
 * looking at, so this reports the names rather than just failing.
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
  try {
    expectNoEmptyFields(await run(NOTHING_OMITTED), optional);
  } catch (error) {
    throw new Error(
      `the response is already incomplete with the full projection, so dropping fields proves ` +
        `nothing — fix the fixture or the projection first. Cause: ${error.message ?? error}`,
    );
  }

  const survived: string[] = [];
  for (const candidate of candidates) {
    let stillComplete = false;
    try {
      expectNoEmptyFields(await run(candidate), optional);
      stillComplete = true;
    } catch {
      // Either the response lost a value or the query itself refused to run without the field.
      // Both mean the field carries weight, which is what this level asserts.
    }
    if (stillComplete) survived.push(Array.isArray(candidate) ? `[${candidate.join(' + ')}]` : candidate);
  }
  if (survived.length)
    throw new Error(
      `these fields can be dropped without any response field going empty: ${survived.join(', ')} — ` +
        `either they are not needed, or the fixture has a gap at exactly that point`,
    );
}

/** Metadata helper: every column an entity would load without a projection. */
export function allColumnNames(metadata: EntityMetadata): string[] {
  return metadata.columns.map((column) => column.propertyName);
}
