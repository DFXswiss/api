import { DataSource, QueryRunner } from 'typeorm';

// getMessageStats picks the newest message per issue with a Postgres-only construct that replaced
// two correlated subqueries. Every other test of that method mocks the query builder, so nothing
// would notice if the expression stopped meaning what it is supposed to mean. This suite executes
// THE EXPRESSIONS THE SERVICE ITSELF USES - imported, not copied - against a real Postgres, so a
// change to the service is either reflected here or breaks these tests.
import { SupportIssueService } from '../services/support-issue.service';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

const LAST_DATE = SupportIssueService.LAST_MESSAGE_DATE_SQL;
const LAST_AUTHOR = SupportIssueService.LAST_MESSAGE_AUTHOR_SQL;

// what the two correlated subqueries did before, kept as the reference the rewrite must match
const REFERENCE_DATE =
  '(SELECT m2.created FROM msgstat_spec.support_message m2 WHERE m2."issueId" = m."issueId" ORDER BY m2.id DESC LIMIT 1)';
const REFERENCE_AUTHOR =
  '(SELECT m2.author FROM msgstat_spec.support_message m2 WHERE m2."issueId" = m."issueId" ORDER BY m2.id DESC LIMIT 1)';

interface StatRow {
  issueId: number;
  count: string;
  lastDate: Date | null;
  lastAuthor: string | null;
}

describeDb('getMessageStats aggregate (real Postgres)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  const stats = (dateExpr: string, authorExpr: string): Promise<StatRow[]> =>
    qr.query(`
      SELECT m."issueId" AS "issueId", COUNT(*) AS count,
             ${dateExpr} AS "lastDate",
             ${authorExpr} AS "lastAuthor"
      FROM msgstat_spec.support_message m
      GROUP BY m."issueId"
      ORDER BY m."issueId"`);

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // own schema: this suite shares the MIGRATION_TEST_PG database with parallel jest workers
    await qr.query(`CREATE SCHEMA IF NOT EXISTS msgstat_spec`);
    await qr.query(`DROP TABLE IF EXISTS msgstat_spec.support_message`);
    await qr.query(
      `CREATE TABLE msgstat_spec.support_message (
         "id" serial PRIMARY KEY, "author" varchar(256), "created" timestamp, "issueId" integer NOT NULL)`,
    );

    await qr.query(`
      INSERT INTO msgstat_spec.support_message ("author", "created", "issueId") VALUES
        -- issue 1: plain thread, newest by id is also the newest by created
        ('Customer', '2026-01-01 10:00', 1),
        ('Josh',     '2026-01-02 10:00', 1),
        -- issue 2: the newest row by id carries an OLDER created - the ordering key must stay the id
        ('Customer', '2026-03-01 10:00', 2),
        ('Josh',     '2026-02-01 10:00', 2),
        -- issue 3: single message
        ('Customer', '2026-01-05 10:00', 3),
        -- issue 4: newest row has NULL author and NULL created
        ('Josh',     '2026-01-06 10:00', 4),
        (NULL,       NULL,               4)`);
  });

  afterAll(async () => {
    await qr.query(`DROP SCHEMA IF EXISTS msgstat_spec CASCADE`);
    await qr.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('returns the newest message per issue by id, not by created', async () => {
    const rows = await stats(LAST_DATE, LAST_AUTHOR);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ issueId: 1, count: '2', lastAuthor: 'Josh' });
    // issue 2 is the discriminating case: 'Josh' has the higher id but the earlier timestamp
    expect(rows[1]).toMatchObject({ issueId: 2, count: '2', lastAuthor: 'Josh' });
    expect(rows[1].lastDate).toEqual(new Date('2026-02-01 10:00'));
    expect(rows[2]).toMatchObject({ issueId: 3, count: '1', lastAuthor: 'Customer' });
  });

  it('keeps a NULL author or date on the newest row as NULL instead of falling back', async () => {
    const rows = await stats(LAST_DATE, LAST_AUTHOR);

    const issue4 = rows.find((r) => r.issueId === 4);
    expect(issue4).toMatchObject({ count: '2', lastAuthor: null, lastDate: null });
  });

  it('matches the correlated-subquery form it replaced, row for row', async () => {
    const rewritten = await stats(LAST_DATE, LAST_AUTHOR);
    const reference = await stats(REFERENCE_DATE, REFERENCE_AUTHOR);

    expect(rewritten).toEqual(reference);
  });

  it('still returns a Date for lastDate, which the mapper hands on unconverted', async () => {
    const [row] = await stats(LAST_DATE, LAST_AUTHOR);

    expect(row.lastDate).toBeInstanceOf(Date);
  });
});
