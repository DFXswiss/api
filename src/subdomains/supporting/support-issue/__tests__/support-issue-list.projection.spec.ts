import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import {
  ListOrderDirection,
  SupportIssueListOrderBy,
} from 'src/subdomains/supporting/support-issue/dto/get-support-issue.dto';
import { SupportIssueDtoMapper } from 'src/subdomains/supporting/support-issue/dto/support-issue-dto.mapper';
import { SupportIssueListDto } from 'src/subdomains/supporting/support-issue/dto/support-issue.dto';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import {
  SupportIssueInternalState,
  SupportIssueReason,
  SupportIssueType,
} from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import {
  SUPPORT_ISSUE_LIST_PROJECTION,
  SUPPORT_ISSUE_LIST_RESPONSE_FIELDS,
  SupportIssueListQuery,
  SupportIssueRepository,
} from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportMessageRepository } from 'src/subdomains/supporting/support-issue/repositories/support-message.repository';
import { DataSource } from 'typeorm';

const SCHEMA = 'support_issue_list_projection_spec';

/**
 * `GET /support/issue/list` and `GET /realunit/support/list` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * Both answer through `SupportIssueDtoMapper.mapSupportIssueListItem` and both loaded whole
 * `SupportIssue` rows: 16 columns for the ten the row shows.
 *
 * The two endpoints differ only in their scope — one filters by department, the other by a list of
 * customer accounts — so both scopes are exercised here.
 */
describeProjection('support issue list — read-path projection', () => {
  let dataSource: DataSource;
  let issues: SupportIssueRepository;
  let messages: SupportMessageRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    issues = new SupportIssueRepository(dataSource.manager);
    messages = new SupportMessageRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  const BASE_QUERY: SupportIssueListQuery = {
    terms: [],
    orderBy: SupportIssueListOrderBy.CREATED,
    orderDir: ListOrderDirection.DESC,
  };

  /**
   * One issue with every column populated.
   *
   * `state`, `type`, `reason` and `department` are set explicitly: all four are TypeScript enums in
   * text columns, and the list filters on three of them — a generated value is not a member, so a
   * filtered query would answer with nothing for a reason that has nothing to do with the
   * projection.
   */
  async function seedIssue(values: Partial<SupportIssue> = {}): Promise<{ issue: SupportIssue; userData: UserData }> {
    const userData = await seedEntity<UserData>(dataSource, UserData);
    const issue = await seedEntity<SupportIssue>(dataSource, SupportIssue, {
      values: {
        userData,
        transaction: null,
        state: SupportIssueInternalState.IN_PROGRESS,
        type: SupportIssueType.TRANSACTION_ISSUE,
        reason: SupportIssueReason.FUNDS_NOT_RECEIVED,
        department: Department.SUPPORT,
        ...values,
      },
    });
    return { issue, userData };
  }

  /**
   * The response the endpoint produces: the projected page, and the message aggregate the endpoint
   * runs over it. Both queries are part of the answer, so both belong in every level.
   */
  async function listOf(
    query: Partial<SupportIssueListQuery>,
    fields = SUPPORT_ISSUE_LIST_PROJECTION.fields,
  ): Promise<{ data: SupportIssueListDto[]; total: number }> {
    const [rows, total] = await issues.findIssueList({ ...BASE_QUERY, ...query }, fields);
    const stats = await messages.findStatsFor(rows.map((row) => row.id));

    return {
      data: rows.map((row) => SupportIssueDtoMapper.mapSupportIssueListItem(row, stats.get(row.id))),
      total,
    };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a listed issue answers with no empty field', async () => {
    const { issue } = await seedIssue();
    // The three message fields of a row come from the aggregate, so a row without messages leaves
    // them legitimately empty — the completeness assertion needs one that has them.
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    const list = await listOf({ departments: [Department.SUPPORT], clerk: issue.clerk });

    expect(list.data).toHaveLength(1);
    expectNoEmptyFields(list);
  }, 120000);

  it('level 1 — an issue without messages answers with a zero count and no last message', async () => {
    const { issue } = await seedIssue();

    const [row] = (await listOf({ departments: [Department.SUPPORT], clerk: issue.clerk })).data;

    expect(row.messageCount).toEqual(0);
    expect(row.lastMessageDate).toBeUndefined();
    expect(row.lastMessageAuthor).toBeUndefined();
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — the customer scope answers only with issues of the scoped accounts', async () => {
    const mine = await seedIssue();
    const other = await seedIssue();

    const list = await listOf({ customerIds: [mine.userData.id] });

    expect(list.data.map((row) => row.uid)).toEqual([mine.issue.uid]);
    expect(list.data.map((row) => row.uid)).not.toContain(other.issue.uid);
  }, 120000);

  it('level 2 — the department gate answers only with issues of the visible departments', async () => {
    const visible = await seedIssue({ department: Department.SUPPORT });
    const hidden = await seedIssue({ department: Department.COMPLIANCE });

    const list = await listOf({ departments: [Department.SUPPORT] });

    expect(list.data.map((row) => row.uid)).toContain(visible.issue.uid);
    expect(list.data.map((row) => row.uid)).not.toContain(hidden.issue.uid);
  }, 120000);

  it.each([
    SupportIssueListOrderBy.CREATED,
    SupportIssueListOrderBy.UPDATED,
    SupportIssueListOrderBy.CLERK,
    SupportIssueListOrderBy.DEPARTMENT,
    SupportIssueListOrderBy.STATE,
  ])(
    'level 2 — the list can be sorted by %s',
    async (orderBy) => {
      const { issue } = await seedIssue();

      // Every sort column has to be part of the projection: with take/skip set, the paginated form of
      // getManyAndCount orders a distinct-id subquery by it, and a column the select does not carry
      // makes Postgres reject the statement.
      const list = await listOf({ clerk: issue.clerk, orderBy, orderDir: ListOrderDirection.ASC, take: 10, skip: 0 });

      expect(list.data).toHaveLength(1);
      expect(list.total).toEqual(1);
    },
    120000,
  );

  it('level 2 — the search matches the fields it names, on the issue and on the account', async () => {
    const { issue, userData } = await seedIssue();

    // Each of these reaches the row through a different branch of the search predicate; the account
    // branches resolve through a join the projection does not select from.
    expect((await listOf({ terms: [issue.name] })).data.map((r) => r.uid)).toEqual([issue.uid]);
    expect((await listOf({ terms: [issue.uid] })).data.map((r) => r.uid)).toEqual([issue.uid]);
    expect((await listOf({ terms: [String(issue.id)] })).data.map((r) => r.uid)).toEqual([issue.uid]);
    expect((await listOf({ terms: [userData.firstname] })).data.map((r) => r.uid)).toEqual([issue.uid]);
    expect((await listOf({ terms: ['no-such-term'] })).data).toHaveLength(0);
  }, 120000);

  it('level 2 — the search finds a term in the message body', async () => {
    const { issue } = await seedIssue();
    const message = await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    // This branch is a correlated subquery over another table. Built from a literal table name it
    // resolves against the search path rather than the schema the rest of the query runs in.
    expect((await listOf({ terms: [message.message] })).data.map((r) => r.uid)).toEqual([issue.uid]);
  }, 120000);

  // The id branch of the search predicate is added only when the term is fully numeric AND fits
  // int4. Anything above 2^31-1 — a pasted phone number is the realistic case — would make Postgres
  // raise a 22003 range error and fail the whole search with a 500.
  it.each([
    ['12345', 'a small numeric term'],
    ['2147483647', 'exactly int4 max'],
    ['41791234567', 'above int4 max — the phone-number case'],
    ['alice', 'a non-numeric term'],
    ['alice 12345', 'both shapes at once'],
  ])(
    'level 2 — the search answers for %s (%s)',
    async (term) => {
      // The assertion is that the statement runs at all: without the guard the third row raises 22003
      // and the search rejects instead of answering.
      await expect(listOf({ terms: term.split(' ') })).resolves.toBeDefined();
    },
    120000,
  );

  it('level 2 — the id branch matches by id alone, and only for a term that fits int4', async () => {
    const clerk = 'id-branch-clerk';
    const { issue } = await seedIssue({ name: 'no-digits-here', uid: 'uid-without-digits', clerk });
    const scoped = (term: string) => listOf({ clerk, terms: [term] });

    // Scoped to this issue's clerk, so the only candidate row is this one — and none of its text
    // fields carries a digit, so a match can only come from `issue.id = :termNId`.
    expect((await scoped(String(issue.id))).data.map((row) => row.uid)).toEqual([issue.uid]);

    // At int4 max the branch is still emitted; one above it the guard has to drop the comparison,
    // or Postgres raises 22003 and the search fails instead of answering nothing.
    expect((await scoped('2147483647')).data).toHaveLength(0);
    expect((await scoped('41791234567')).data).toHaveLength(0);
  }, 120000);

  it('level 2 — the id tie-break orders rows that share a sort key', async () => {
    // Two issues in the same state, sorted by state: the primary key is equal for both, so the
    // order is decided by the id tie-break alone. Without it the order is whatever storage returns,
    // and a page boundary can drop or repeat a row.
    const first = await seedIssue({ clerk: 'tie-break', state: SupportIssueInternalState.IN_PROGRESS });
    const second = await seedIssue({ clerk: 'tie-break', state: SupportIssueInternalState.IN_PROGRESS });

    const ascending = await listOf({
      clerk: 'tie-break',
      orderBy: SupportIssueListOrderBy.STATE,
      orderDir: ListOrderDirection.ASC,
    });
    const descending = await listOf({
      clerk: 'tie-break',
      orderBy: SupportIssueListOrderBy.STATE,
      orderDir: ListOrderDirection.DESC,
    });

    expect(ascending.data.map((row) => row.id)).toEqual([first.issue.id, second.issue.id]);
    expect(descending.data.map((row) => row.id)).toEqual([second.issue.id, first.issue.id]);
  }, 120000);

  it('level 2 — the total counts every match, not just the page', async () => {
    const first = await seedIssue({ clerk: 'page-clerk' });
    await seedIssue({ clerk: 'page-clerk' });

    const list = await listOf({ clerk: 'page-clerk', take: 1, skip: 0, orderDir: ListOrderDirection.ASC });

    expect(list.data).toHaveLength(1);
    expect(list.data[0].uid).toEqual(first.issue.uid);
    expect(list.total).toEqual(2);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — every field feeding the list response is required', async () => {
    const { issue } = await seedIssue();
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    await expectEveryFieldRequired(SUPPORT_ISSUE_LIST_RESPONSE_FIELDS, (omitted) =>
      listOf(
        { departments: [Department.SUPPORT], clerk: issue.clerk },
        projectionFieldsWithout(SUPPORT_ISSUE_LIST_PROJECTION.fields, omitted),
      ),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it('level 4 — the projected response equals the one from a full load', async () => {
    const { issue } = await seedIssue();
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    const projected = await listOf({ departments: [Department.SUPPORT], clerk: issue.clerk });
    // The unprojected load is the second source: every column of the row, which is what the query
    // fetched before the conversion.
    const full = await dataSource
      .getRepository(SupportIssue)
      .find({ where: { clerk: issue.clerk }, loadEagerRelations: false });

    const stats = await messages.findStatsFor(full.map((row) => row.id));
    expect(projected.data).toEqual(
      full.map((row) => SupportIssueDtoMapper.mapSupportIssueListItem(row, stats.get(row.id))),
    );
  }, 120000);
});
