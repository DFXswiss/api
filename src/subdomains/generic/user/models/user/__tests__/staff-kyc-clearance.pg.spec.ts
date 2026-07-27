import { DataSource } from 'typeorm';
import { BlankChars, nonBlankPredicate } from '../staff-kyc-clearance.service';

// The clearance query decides who reaches every elevated endpoint, and its verifiedName condition is raw
// SQL: a mocked repository never executes it, so the unit suite cannot tell a correct predicate from one
// that silently clears blank names. This suite runs the exact fragment against a real Postgres and pins
// it to the semantics it replaced — `String.prototype.trim()`.
//
// Skipped unless a connection string is provided, matching the migration suites in this repo; CI runs it
// against its throwaway Postgres service.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

const SCHEMA = 'staff_kyc_clearance_spec';

// Blank in JS, and every one of them a plausible copy-paste artefact in an identity field. Bare
// Postgres `TRIM()` strips only U+0020, so all but the plain-space cases would survive it.
const BLANK_NAMES = [
  '',
  '\u0020',
  '\u0020\u0020\u0020',
  '\u0009', // tab
  '\u000a', // line feed
  '\u000d\u000a', // CRLF
  '\u000b', // vertical tab
  '\u000c', // form feed
  '\u00a0', // non-breaking space
  '\u1680', // ogham space mark
  '\u2003', // em space
  '\u202f', // narrow no-break space
  '\u205f', // medium mathematical space
  '\u3000', // ideographic space
  '\ufeff', // zero-width no-break space
  '\u0020\u0009\u00a0\u3000\u0020', // mixed
];

// Real identifications, including ones padded with the same characters — padding must never disqualify.
const REAL_NAMES = [
  'Alice Example',
  '\u0020Alice Example\u0020',
  '\u0009Alice Example\u000a',
  '\u00a0Alice Example\u3000',
  'X',
];

describeDb('staff KYC clearance verifiedName predicate (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
    await dataSource.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await dataSource.query(`CREATE SCHEMA ${SCHEMA}`);
    // Quoted camelCase column, exactly as the migrations create it — an unquoted identifier would be
    // folded to lowercase by Postgres and the predicate would fail at runtime rather than in review.
    await dataSource.query(`CREATE TABLE ${SCHEMA}.user_data (id serial PRIMARY KEY, "verifiedName" varchar)`);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await dataSource.destroy();
  });

  async function selectMatching(names: (string | null)[]): Promise<(string | null)[]> {
    await dataSource.query(`TRUNCATE ${SCHEMA}.user_data`);
    for (const name of names) {
      await dataSource.query(`INSERT INTO ${SCHEMA}.user_data ("verifiedName") VALUES ($1)`, [name]);
    }

    // $1 stands in for the named :blankChars parameter TypeORM binds; the fragment itself is verbatim.
    const predicate = nonBlankPredicate('"verifiedName"').replace(':blankChars', '$1');
    const rows = await dataSource.query(
      `SELECT "verifiedName" FROM ${SCHEMA}.user_data WHERE ${predicate} ORDER BY id`,
      [BlankChars],
    );

    return rows.map((row: { verifiedName: string | null }) => row.verifiedName);
  }

  it('excludes NULL', async () => {
    await expect(selectMatching([null])).resolves.toEqual([]);
  });

  it.each(BLANK_NAMES)('excludes the blank name %j', async (name) => {
    await expect(selectMatching([name])).resolves.toEqual([]);
  });

  it.each(REAL_NAMES)('keeps the real name %j', async (name) => {
    await expect(selectMatching([name])).resolves.toEqual([name]);
  });

  // The property that matters: the SQL predicate and the JS check it replaced must agree on every input.
  // A disagreement here is either a locked-out staff member or a cleared account with no identification.
  it('agrees with String.prototype.trim() on every case', async () => {
    const all = [null, ...BLANK_NAMES, ...REAL_NAMES];

    const fromSql = await selectMatching(all);
    const fromJs = all.filter((name) => name?.trim());

    expect(fromSql).toEqual(fromJs);
  });
});
