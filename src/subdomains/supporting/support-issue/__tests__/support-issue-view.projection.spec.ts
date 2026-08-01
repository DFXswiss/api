import {
  SUPPORT_ISSUE_PROJECTION,
  SUPPORT_ISSUE_RESPONSE_FIELDS,
  SupportIssueRepository,
} from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import {
  SUPPORT_MESSAGE_PROJECTION,
  SUPPORT_MESSAGE_RESPONSE_FIELDS,
  SupportMessageRepository,
} from 'src/subdomains/supporting/support-issue/repositories/support-message.repository';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueDtoMapper } from 'src/subdomains/supporting/support-issue/dto/support-issue-dto.mapper';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SupportIssueInternalState } from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { ConfigService } from 'src/config/config';
import { DataSource } from 'typeorm';

const SCHEMA = 'support_issue_view_projection_spec';

/**
 * `GET /support/issue` and `GET /support/issue/:id` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * Both answer through `SupportIssueDtoMapper.mapSupportIssue`, and both loaded whole `SupportIssue`
 * rows for nine values. `GET /support/issue/:id` additionally loads the message
 * thread, which is projected separately.
 *
 * The search condition of `GET /support/issue/:id` is the access check for this endpoint family, so
 * it gets assertions of its own below.
 */
describeProjection('support issue view — read-path projection', () => {
  let dataSource: DataSource;
  let issues: SupportIssueRepository;
  let messages: SupportMessageRepository;

  beforeAll(async () => {
    // `Transaction.url` is a getter over the module-level Config; without this it reads undefined
    // and the mapper throws before any assertion is reached.
    new ConfigService();
    dataSource = await createProjectionDataSource(SCHEMA);
    issues = new SupportIssueRepository(dataSource.manager);
    messages = new SupportMessageRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  async function seedIssue(
    withTransaction = true,
    state = SupportIssueInternalState.IN_PROGRESS,
  ): Promise<{ issue: SupportIssue; userData: UserData }> {
    const userData = await seedEntity<UserData>(dataSource, UserData);
    const transaction = withTransaction
      ? await seedEntity<Transaction>(dataSource, Transaction, { values: { userData } })
      : null;
    const limitRequest = await seedEntity<LimitRequest>(dataSource, LimitRequest);
    // `state` is a TypeScript enum in a text column: a generated value is not a member, and the
    // mapper that translates it to the public state then answers undefined.
    const issue = await seedEntity<SupportIssue>(dataSource, SupportIssue, {
      values: { userData, transaction, limitRequest, state },
    });
    return { issue, userData };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — the issue list answers with no empty field', async () => {
    const { userData } = await seedIssue();

    const list = (await issues.findIssuesForAccount(userData.id)).map(SupportIssueDtoMapper.mapSupportIssue);

    expect(list).toHaveLength(1);
    // The list endpoint does not load the thread — `mapSupportIssue` falls back to an empty array.
    expectNoEmptyFields(list, ['[0].messages']);
  }, 120000);

  it('level 1 — a single issue answers with no empty field, thread included', async () => {
    const { issue } = await seedIssue();
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    const loaded = await issues.findIssueBy({ uid: issue.uid });
    loaded.messages = await messages.findThread(loaded.id);

    expectNoEmptyFields(SupportIssueDtoMapper.mapSupportIssue(loaded));
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — an issue without a transaction answers without one', async () => {
    const { issue } = await seedIssue(false);
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    const loaded = await issues.findIssueBy({ uid: issue.uid });
    loaded.messages = await messages.findThread(loaded.id);
    const dto = SupportIssueDtoMapper.mapSupportIssue(loaded);

    // `mapTransaction` answers null without a transaction id. The rest must stay complete, or the
    // left join was written as an inner one and every issue raised without a transaction vanishes.
    expect(dto.transaction).toBeNull();
    expectNoEmptyFields(dto, ['transaction']);
  }, 120000);

  it('level 2 — the thread returns only messages newer than the given id', async () => {
    const { issue } = await seedIssue();
    const first = await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });
    const second = await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    const incremental = await messages.findThread(issue.id, first.id);

    expect(incremental.map((message) => message.id)).toEqual([second.id]);
  }, 120000);

  // --- the search condition is the access check, so it gets its own assertions --- //

  it('finds an issue by its uid, and by numeric id scoped to the owning account', async () => {
    const { issue, userData } = await seedIssue();
    const stranger = await seedEntity<UserData>(dataSource, UserData);

    expect((await issues.findIssueBy({ uid: issue.uid }))?.id).toEqual(issue.id);
    expect((await issues.findIssueBy({ id: issue.id, userData: { id: userData.id } }))?.id).toEqual(issue.id);
    // Scoped to a different account it must not resolve — the projection must not have widened the
    // condition by dropping the join it rests on.
    expect(await issues.findIssueBy({ id: issue.id, userData: { id: stranger.id } })).toBeNull();
  }, 120000);

  it('finds an issue by the uid of the quote behind it', async () => {
    // `transactionRequest` is nullable, so it has to be asked for explicitly.
    const userData = await seedEntity<UserData>(dataSource, UserData);
    const limitRequest = await seedEntity<LimitRequest>(dataSource, LimitRequest);
    const issue = await seedEntity<SupportIssue>(dataSource, SupportIssue, {
      values: { userData, transaction: null, limitRequest, state: SupportIssueInternalState.IN_PROGRESS },
      relations: { transactionRequest: true },
    });

    // The third branch of the search condition resolves through `transactionRequest`, a relation the
    // projection does not join for the response. `setFindOptions` has to add it.
    expect(issue.transactionRequest).toBeDefined();
    const found = await issues.findIssueBy({ transactionRequest: { uid: issue.transactionRequest.uid } });
    expect(found?.id).toEqual(issue.id);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — every field feeding the issue response is required', async () => {
    const { issue } = await seedIssue();
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    await expectEveryFieldRequired(SUPPORT_ISSUE_RESPONSE_FIELDS, async (omitted) => {
      const loaded = await issues.findIssueBy(
        { uid: issue.uid },
        projectionFieldsWithout(SUPPORT_ISSUE_PROJECTION.fields, omitted),
      );
      loaded.messages = await messages.findThread(loaded.id);
      return SupportIssueDtoMapper.mapSupportIssue(loaded);
    });
  }, 300000);

  it('level 3 — every field feeding a message is required', async () => {
    const { issue } = await seedIssue();
    await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

    await expectEveryFieldRequired(SUPPORT_MESSAGE_RESPONSE_FIELDS, (omitted) =>
      messages
        .findThread(issue.id, 0, projectionFieldsWithout(SUPPORT_MESSAGE_PROJECTION.fields, omitted))
        .then((thread) => thread.map(SupportIssueDtoMapper.mapSupportMessage)),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([true, false])(
    'level 4 — with transaction=%s the projected response equals the one from a full load',
    async (withTransaction) => {
      const { issue } = await seedIssue(withTransaction);
      await seedEntity<SupportMessage>(dataSource, SupportMessage, { values: { issue } });

      const loaded = await issues.findIssueBy({ uid: issue.uid });
      loaded.messages = await messages.findThread(loaded.id);

      // The unprojected load is the second source: the same relations selected whole.
      const full = await dataSource.getRepository(SupportIssue).findOne({
        where: { uid: issue.uid },
        relations: { transaction: true, limitRequest: true },
      });
      full.messages = await dataSource.getRepository(SupportMessage).findBy({ issue: { id: issue.id } });

      expect(SupportIssueDtoMapper.mapSupportIssue(loaded)).toEqual(SupportIssueDtoMapper.mapSupportIssue(full));
    },
    120000,
  );
});
