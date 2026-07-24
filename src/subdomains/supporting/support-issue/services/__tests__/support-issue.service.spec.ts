import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ConfigModule from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { SupportClerkAccountDto } from 'src/shared/models/setting/dto/support-clerk-account.dto';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PhoneCallStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CreateSupportIssueBaseDto } from 'src/subdomains/supporting/support-issue/dto/create-support-issue.dto';
import { CreateSupportMessageDto } from 'src/subdomains/supporting/support-issue/dto/create-support-message.dto';
import {
  GetSupportIssueFilter,
  GetSupportIssueListFilter,
  ListOrderDirection,
  SupportIssueListOrderBy,
} from 'src/subdomains/supporting/support-issue/dto/get-support-issue.dto';
import { UpdateSupportIssueDto } from 'src/subdomains/supporting/support-issue/dto/update-support-issue.dto';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import {
  AutoResponder,
  CustomerAuthor,
  SupportMessage,
} from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import {
  SupportIssueInternalState,
  SupportIssueReason,
  SupportIssueState,
  SupportIssueType,
} from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportLogType } from 'src/subdomains/supporting/support-issue/enums/support-log.enum';
import { SupportIssueRepository } from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportMessageRepository } from 'src/subdomains/supporting/support-issue/repositories/support-message.repository';
import { LimitRequestService } from 'src/subdomains/supporting/support-issue/services/limit-request.service';
import { SupportDocumentService } from 'src/subdomains/supporting/support-issue/services/support-document.service';
import { SupportIssueNotificationService } from 'src/subdomains/supporting/support-issue/services/support-issue-notification.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { SupportLogService } from 'src/subdomains/supporting/support-issue/services/support-log.service';
import { REALUNIT_WALLET_NAME } from 'src/subdomains/supporting/notification/realunit-mail-rules';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { CreateSupportIssueDto } from 'src/subdomains/supporting/support-issue/dto/create-support-issue.dto';
import { SupportIssueDto, SupportMessageDto } from 'src/subdomains/supporting/support-issue/dto/support-issue.dto';

// Shared dependency bag + service factory for the describe blocks below that don't need a
// hand-shaped query-builder mock: every collaborator is a fresh DeepMocked<T> per call, so tests
// stay isolated without repeating the 12-arg constructor at every call site.
function buildService() {
  const supportIssueRepo = createMock<SupportIssueRepository>();
  const transactionService = createMock<TransactionService>();
  const documentService = createMock<SupportDocumentService>();
  const userDataService = createMock<UserDataService>();
  const messageRepo = createMock<SupportMessageRepository>();
  const supportIssueNotificationService = createMock<SupportIssueNotificationService>();
  const limitRequestService = createMock<LimitRequestService>();
  const transactionRequestService = createMock<TransactionRequestService>();
  const supportLogService = createMock<SupportLogService>();
  const bankDataService = createMock<BankDataService>();
  const settingService = createMock<SettingService>();
  const walletService = createMock<WalletService>();

  const service = new SupportIssueService(
    supportIssueRepo,
    transactionService,
    documentService,
    userDataService,
    messageRepo,
    supportIssueNotificationService,
    limitRequestService,
    transactionRequestService,
    supportLogService,
    bankDataService,
    settingService,
    walletService,
  );

  return {
    service,
    supportIssueRepo,
    transactionService,
    documentService,
    userDataService,
    messageRepo,
    supportIssueNotificationService,
    limitRequestService,
    transactionRequestService,
    supportLogService,
    bankDataService,
    settingService,
    walletService,
  };
}

describe('SupportIssueService.getSupportIssueList', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let qb: Record<string, jest.Mock>;

  // chainable query-builder recorder: every builder method returns the same object,
  // getManyAndCount short-circuits getMessageStats (empty result set).
  function createQbMock(): Record<string, jest.Mock> {
    const builder: Record<string, jest.Mock> = {};
    for (const method of ['leftJoin', 'andWhere', 'orderBy', 'addOrderBy', 'take', 'skip']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    return builder;
  }

  const run = (filter: Partial<GetSupportIssueListFilter>, role: UserRole = UserRole.ADMIN) =>
    service.getSupportIssueList(filter as GetSupportIssueListFilter, role);

  const andWhereClauses = (): string[] => qb.andWhere.mock.calls.map((c) => String(c[0]));

  // the department parameter handed to the "issue.department IN (:...departments)" clause (undefined if absent)
  const departmentsParam = (): Department[] | undefined => {
    const call = qb.andWhere.mock.calls.find((c) => String(c[0]).includes('issue.department IN'));
    return call?.[1]?.departments as Department[] | undefined;
  };

  beforeEach(() => {
    qb = createQbMock();
    supportIssueRepo = createMock<SupportIssueRepository>();
    (supportIssueRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      createMock<SupportMessageRepository>(),
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  describe('clerk filter', () => {
    it('filters by clerk when provided', async () => {
      await run({ clerk: 'Alice' });
      expect(qb.andWhere).toHaveBeenCalledWith('issue.clerk = :clerk', { clerk: 'Alice' });
    });

    it('does not add a clerk clause when absent', async () => {
      await run({});
      expect(andWhereClauses().some((c) => c.includes('issue.clerk ='))).toBe(false);
    });
  });

  describe('timeframe filter', () => {
    it('filters by createdFrom as a Date lower bound', async () => {
      await run({ createdFrom: '2026-01-01T00:00:00.000Z' });
      expect(qb.andWhere).toHaveBeenCalledWith('issue.created >= :createdFrom', {
        createdFrom: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it('filters by createdTo as a Date upper bound', async () => {
      await run({ createdTo: '2026-02-01T00:00:00.000Z' });
      expect(qb.andWhere).toHaveBeenCalledWith('issue.created <= :createdTo', {
        createdTo: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('extends a date-only createdTo to the end of that day (inclusive)', async () => {
      await run({ createdTo: '2026-02-01' });
      expect(qb.andWhere).toHaveBeenCalledWith('issue.created <= :createdTo', {
        createdTo: new Date('2026-02-01T23:59:59.999Z'),
      });
    });

    it('does not add date clauses when absent', async () => {
      await run({});
      expect(andWhereClauses().some((c) => c.includes('issue.created'))).toBe(false);
    });
  });

  describe('sorting', () => {
    it('defaults to created DESC with an id tie-break for stable pagination', async () => {
      await run({});
      expect(qb.orderBy).toHaveBeenCalledWith('issue.created', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('issue.id', 'DESC');
    });

    it('applies a whitelisted sort column with an id tie-break for stable pagination', async () => {
      await run({ orderBy: SupportIssueListOrderBy.CLERK, orderDir: ListOrderDirection.ASC });
      expect(qb.orderBy).toHaveBeenCalledWith('issue.clerk', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('issue.id', 'ASC');
    });

    it('rejects an out-of-whitelist orderBy at DTO validation (the actual injection guard)', async () => {
      const dto = plainToInstance(GetSupportIssueListFilter, { orderBy: 'id); DROP TABLE support_issue; --' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'orderBy')?.constraints).toHaveProperty('isEnum');
    });
  });

  // Guards the security-relevant department narrowing: an out-of-set ?department= must never widen access,
  // the role's allowed set is the ceiling, and a role with no department access never even queries.
  describe('department narrowing', () => {
    it('keeps support locked to its own department, ignoring an out-of-set ?department (no escalation)', async () => {
      await run({ department: Department.COMPLIANCE }, UserRole.SUPPORT);
      expect(departmentsParam()).toEqual([Department.SUPPORT]);
    });

    it('lets compliance narrow to the support department via ?department', async () => {
      await run({ department: Department.SUPPORT }, UserRole.COMPLIANCE);
      expect(departmentsParam()).toEqual([Department.SUPPORT]);
    });

    it('defaults compliance to its full allowed set (support + compliance) without ?department', async () => {
      await run({}, UserRole.COMPLIANCE);
      expect(departmentsParam()).toEqual([Department.SUPPORT, Department.COMPLIANCE]);
    });

    it('applies an arbitrary ?department for an unrestricted admin', async () => {
      await run({ department: Department.MARKETING }, UserRole.ADMIN);
      expect(departmentsParam()).toEqual([Department.MARKETING]);
    });

    it('applies no department filter for admin without ?department (unrestricted)', async () => {
      await run({}, UserRole.ADMIN);
      expect(departmentsParam()).toBeUndefined();
    });

    it('applies no department filter for super admin without ?department (unrestricted)', async () => {
      await run({}, UserRole.SUPER_ADMIN);
      expect(departmentsParam()).toBeUndefined();
    });

    it('returns nothing for a role with no department access, without querying', async () => {
      const result = await run({}, UserRole.USER);
      expect(result).toEqual({ data: [], total: 0 });
      expect(supportIssueRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('pagination', () => {
    it('applies take and skip when both are provided', async () => {
      await run({ states: [SupportIssueInternalState.PENDING], take: 20, skip: 40 });
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(qb.skip).toHaveBeenCalledWith(40);
    });

    it('does not apply skip when take is absent', async () => {
      await run({});
      expect(qb.take).not.toHaveBeenCalled();
      expect(qb.skip).not.toHaveBeenCalled();
    });
  });

  // Non-empty result path: exercises the SupportIssueListDto mapping and the private
  // getMessageStats aggregation getSupportIssueList calls for every non-empty result page.
  // Uses its own service instance so the message-repo query builder can be shaped independently
  // of the outer suite's leftJoin/andWhere-only qb mock.
  describe('non-empty result mapping (getMessageStats)', () => {
    let localService: SupportIssueService;
    let localSupportIssueRepo: DeepMocked<SupportIssueRepository>;
    let localMessageRepo: DeepMocked<SupportMessageRepository>;
    let localQb: Record<string, jest.Mock>;
    let messageQb: Record<string, jest.Mock>;

    const issueRow = Object.assign(new SupportIssue(), {
      id: 1,
      uid: 'x',
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      state: SupportIssueInternalState.PENDING,
      name: 'Help',
      clerk: 'Alice',
      department: Department.SUPPORT,
      created: new Date('2026-01-01T00:00:00.000Z'),
    });

    beforeEach(() => {
      localQb = createQbMock();
      localQb.getManyAndCount.mockResolvedValue([[issueRow], 1]);

      messageQb = {};
      for (const m of ['select', 'where', 'groupBy']) {
        messageQb[m] = jest.fn(() => messageQb);
      }
      // addSelect is called both with a plain (expr, alias) pair (the COUNT(*) select) and with a
      // sub-query builder factory (the lastDate/lastAuthor correlated selects) - invoke the factory
      // against a chainable sub-builder stub so its body (the actual sub-query shape) executes too.
      messageQb.addSelect = jest.fn((selectionOrFactory: unknown) => {
        if (typeof selectionOrFactory === 'function') {
          const subQb: Record<string, jest.Mock> = {};
          for (const m of ['select', 'from', 'where', 'orderBy', 'limit']) {
            subQb[m] = jest.fn(() => subQb);
          }
          (selectionOrFactory as (sub: Record<string, jest.Mock>) => unknown)(subQb);
        }
        return messageQb;
      });
      messageQb.getRawMany = jest
        .fn()
        .mockResolvedValue([
          { issueId: '1', count: '3', lastDate: new Date('2026-01-02T00:00:00.000Z'), lastAuthor: 'Support' },
        ]);

      localSupportIssueRepo = createMock<SupportIssueRepository>();
      (localSupportIssueRepo.createQueryBuilder as jest.Mock).mockReturnValue(localQb);
      localMessageRepo = createMock<SupportMessageRepository>();
      (localMessageRepo.createQueryBuilder as jest.Mock).mockReturnValue(messageQb);

      localService = new SupportIssueService(
        localSupportIssueRepo,
        createMock<TransactionService>(),
        createMock<SupportDocumentService>(),
        createMock<UserDataService>(),
        localMessageRepo,
        createMock<SupportIssueNotificationService>(),
        createMock<LimitRequestService>(),
        createMock<TransactionRequestService>(),
        createMock<SupportLogService>(),
        createMock<BankDataService>(),
        createMock<SettingService>(),
        createMock<WalletService>(),
      );
    });

    it('maps a non-empty page through getMessageStats into the list DTO', async () => {
      const result = await localService.getSupportIssueList({} as GetSupportIssueListFilter, UserRole.ADMIN);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 1,
        uid: 'x',
        messageCount: 3,
        lastMessageAuthor: 'Support',
        lastMessageDate: new Date('2026-01-02T00:00:00.000Z'),
      });

      // getMessageStats batched the single issue id into the message query builder
      expect(localMessageRepo.createQueryBuilder).toHaveBeenCalledWith('m');
      expect(messageQb.where).toHaveBeenCalledWith('m."issueId" IN (:...ids)', { ids: [1] });
      expect(messageQb.groupBy).toHaveBeenCalledWith('m."issueId"');
    });

    it('falls back to undefined lastDate/lastAuthor when the correlated sub-selects yield null (no messages yet)', async () => {
      messageQb.getRawMany.mockResolvedValue([{ issueId: '1', count: '0', lastDate: null, lastAuthor: null }]);

      const result = await localService.getSupportIssueList({} as GetSupportIssueListFilter, UserRole.ADMIN);

      expect(result.data[0]).toMatchObject({
        messageCount: 0,
        lastMessageDate: undefined,
        lastMessageAuthor: undefined,
      });
    });
  });

  // Guards the state predicate + department scope the list query relies on; the composite index
  // on support_issue (state, created, id) is state-leading, so a refactor that drops the state
  // filter would make the paged-tab index-scan-backward degrade to a full seq scan.
  describe('department + state filter (composite index guard)', () => {
    it('emits both the department scope and the state filter when the filter provides states', async () => {
      await run(
        { states: [SupportIssueInternalState.PENDING, SupportIssueInternalState.IN_PROGRESS] },
        UserRole.SUPPORT,
      );
      expect(andWhereClauses().some((c) => c.includes('issue.department IN'))).toBe(true);
      expect(qb.andWhere).toHaveBeenCalledWith('issue.state IN (:...states)', {
        states: [SupportIssueInternalState.PENDING, SupportIssueInternalState.IN_PROGRESS],
      });
    });

    it('does not add a state clause when the filter provides no states', async () => {
      await run({});
      expect(andWhereClauses().some((c) => c.includes('issue.state IN'))).toBe(false);
    });
  });

  // The id branch of the search predicate is added only when the term is fully numeric AND
  // fits int4. Anything above 2^31-1 (a pasted phone number) would produce a Postgres 22003
  // range error and 500 the entire search — this block pins the guard against that regression.
  describe('search-term id branch', () => {
    // returns the parameter bag from the last andWhere call that includes the search predicate
    const lastSearchParams = (): Record<string, unknown> | undefined => {
      const calls = qb.andWhere.mock.calls;
      const call = [...calls].reverse().find((c) => String(c[0]).includes('issue.name LIKE'));
      return call?.[1] as Record<string, unknown> | undefined;
    };

    // returns the SQL fragment string from the last search predicate
    const lastSearchFragment = (): string => {
      const calls = qb.andWhere.mock.calls;
      const call = [...calls].reverse().find((c) => String(c[0]).includes('issue.name LIKE'));
      return String(call?.[0] ?? '');
    };

    it('emits the id clause for a small numeric term and binds the int', async () => {
      await run({ query: '12345' });
      expect(lastSearchFragment()).toContain('issue.id = :term0Id');
      expect(lastSearchParams()).toEqual({ term0: '%12345%', term0Id: 12345 });
    });

    it('emits the id clause for exactly int4 max (2147483647)', async () => {
      await run({ query: '2147483647' });
      expect(lastSearchFragment()).toContain('issue.id = :term0Id');
      expect(lastSearchParams()).toMatchObject({ term0Id: 2147483647 });
    });

    it('omits the id clause and Id-bind for a numeric term above int4 max (phone-number regression)', async () => {
      await run({ query: '41791234567' });
      expect(lastSearchFragment()).not.toContain('issue.id = :term0Id');
      expect(lastSearchParams()).toEqual({ term0: '%41791234567%' });
    });

    it('omits the id clause for a non-numeric term', async () => {
      await run({ query: 'alice' });
      expect(lastSearchFragment()).not.toContain('issue.id = :term0Id');
      expect(lastSearchParams()).toEqual({ term0: '%alice%' });
    });

    it('mixes term shapes across ANDed clauses', async () => {
      await run({ query: 'alice 12345' });
      const calls = qb.andWhere.mock.calls.filter((c) => String(c[0]).includes('issue.name LIKE'));
      expect(calls).toHaveLength(2);
      expect(String(calls[0][0])).not.toContain('issue.id = :term0Id');
      expect(String(calls[1][0])).toContain('issue.id = :term1Id');
      expect(calls[0][1]).toEqual({ term0: '%alice%' });
      expect(calls[1][1]).toEqual({ term1: '%12345%', term1Id: 12345 });
    });
  });

  describe('type filter', () => {
    it('filters by type when provided', async () => {
      await run({ type: SupportIssueType.KYC_ISSUE });
      expect(qb.andWhere).toHaveBeenCalledWith('issue.type = :type', { type: SupportIssueType.KYC_ISSUE });
    });

    it('does not add a type clause when absent', async () => {
      await run({});
      expect(andWhereClauses().some((c) => c.includes('issue.type ='))).toBe(false);
    });
  });

  // customerIds (RealUnit tenant scope) replaces the department gate and joins through userData instead;
  // covers both the empty-scope fail-close and the actual scoped query shape.
  describe('customerIds scope (RealUnit tenant)', () => {
    it('returns nothing for an empty customerIds scope, without querying (fail-closed)', async () => {
      const result = await service.getSupportIssueList({} as GetSupportIssueListFilter, UserRole.REALUNIT, []);
      expect(result).toEqual({ data: [], total: 0 });
      expect(supportIssueRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('scopes to the customerIds via a userData join, in place of the department filter', async () => {
      await service.getSupportIssueList({} as GetSupportIssueListFilter, UserRole.REALUNIT, [1, 2, 3]);
      expect(qb.leftJoin).toHaveBeenCalledWith('issue.userData', 'userData');
      expect(qb.andWhere).toHaveBeenCalledWith('"userData".id IN (:...customerIds)', { customerIds: [1, 2, 3] });
      expect(andWhereClauses().some((c) => c.includes('issue.department IN'))).toBe(false);
    });
  });
});

describe('SupportIssueService.getSupportIssueCounts', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let qb: Record<string, jest.Mock>;

  // chainable query-builder recorder mirroring the shape getSupportIssueCounts builds
  // (select/addSelect/groupBy, an optional innerJoin, and andWhere for the scope predicate).
  function createCountsQbMock(): Record<string, jest.Mock> {
    const builder: Record<string, jest.Mock> = {};
    for (const method of ['select', 'addSelect', 'groupBy', 'innerJoin', 'andWhere']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn().mockResolvedValue([]);
    return builder;
  }

  const andWhereClauses = (): string[] => qb.andWhere.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qb = createCountsQbMock();
    supportIssueRepo = createMock<SupportIssueRepository>();
    (supportIssueRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      createMock<SupportMessageRepository>(),
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  // Guards the department scope + state group-by of the counts query. Note: the composite index
  // on support_issue (state, created, id) does not accelerate this group-by (it stays a seq scan);
  // this guard just pins the query shape the tab badges depend on.
  it('groups by state and scopes to the department IN predicate for a department-restricted role', async () => {
    await service.getSupportIssueCounts(UserRole.SUPPORT);
    expect(qb.groupBy).toHaveBeenCalledWith('issue.state');
    expect(andWhereClauses().some((c) => c.includes('issue.department IN'))).toBe(true);
  });

  it('does not scope by department for an unrestricted admin role', async () => {
    await service.getSupportIssueCounts(UserRole.ADMIN);
    expect(qb.groupBy).toHaveBeenCalledWith('issue.state');
    expect(andWhereClauses().some((c) => c.includes('issue.department IN'))).toBe(false);
  });

  // customerIds (RealUnit tenant scope) takes precedence over the department gate and joins
  // through userData instead.
  it('scopes to the customerIds predicate via an innerJoin when customerIds are provided', async () => {
    await service.getSupportIssueCounts(UserRole.SUPPORT, [1, 2, 3]);
    expect(qb.innerJoin).toHaveBeenCalledWith('issue.userData', 'scopeUd');
    expect(qb.andWhere).toHaveBeenCalledWith('scopeUd.id IN (:...customerIds)', { customerIds: [1, 2, 3] });
  });

  it('returns an all-zero record without querying for an empty customerIds scope (fail-closed)', async () => {
    const counts = await service.getSupportIssueCounts(UserRole.REALUNIT, []);
    const zero = Object.fromEntries(Object.values(SupportIssueInternalState).map((s) => [s, 0]));
    expect(counts).toEqual(zero);
    expect(supportIssueRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('SupportIssueService.closeIssue', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let messageRepo: DeepMocked<SupportMessageRepository>;
  let supportLogService: DeepMocked<SupportLogService>;

  function makeIssue(state: SupportIssueInternalState): SupportIssue {
    return Object.assign(new SupportIssue(), {
      id: 7,
      uid: 'Iabc',
      state,
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      name: 'Help',
      created: new Date('2026-01-01T00:00:00.000Z'),
      userData: { id: 42 } as UserData,
    });
  }

  beforeEach(() => {
    // getIssueSearch reads Config.prefixes; Config is only populated at bootstrap, so stub it here
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { issueUidPrefix: 'issue_', quoteUidPrefix: 'quote_' },
    };

    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();
    supportLogService = createMock<SupportLogService>();
    messageRepo.findBy.mockResolvedValue([]);

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      messageRepo,
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      supportLogService,
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  it('throws NotFound when the issue does not exist', async () => {
    supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(service.closeIssue('7', 42)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes numeric-id lookups to the requesting owner', async () => {
    supportIssueRepo.findOne.mockResolvedValue(makeIssue(SupportIssueInternalState.PENDING));
    await service.closeIssue('7', 42);
    expect(supportIssueRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, userData: { id: 42 } } }),
    );
  });

  it('resolves an anonymous UID close to a uid lookup without an owner scope', async () => {
    supportIssueRepo.findOne.mockResolvedValue(makeIssue(SupportIssueInternalState.PENDING));
    await service.closeIssue('issue_abc');
    expect(supportIssueRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: 'issue_abc' } }));
  });

  it('resolves a quote-prefixed id to a transactionRequest uid lookup', async () => {
    supportIssueRepo.findOne.mockResolvedValue(makeIssue(SupportIssueInternalState.PENDING));
    await service.closeIssue('quote_xyz');
    expect(supportIssueRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transactionRequest: { uid: 'quote_xyz' } } }),
    );
  });

  it('rejects a non-integer numeric id for an authenticated owner lookup', async () => {
    await expect(service.closeIssue('7.5', 42)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed with Unauthorized for a non-prefixed id without an owner scope (no capability token, no session)', async () => {
    await expect(service.closeIssue('42')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('completes an open issue and logs it as a customer action', async () => {
    const issue = makeIssue(SupportIssueInternalState.PENDING);
    supportIssueRepo.findOne.mockResolvedValue(issue);

    const dto = await service.closeIssue('7', 42);

    expect(supportIssueRepo.update).toHaveBeenCalledWith(7, { state: SupportIssueInternalState.COMPLETED });
    expect(supportLogService.createSupportLog).toHaveBeenCalledWith(
      issue.userData,
      expect.objectContaining({ type: SupportLogType.CUSTOMER, state: SupportIssueInternalState.COMPLETED }),
    );
    expect(dto.state).toBe(SupportIssueState.COMPLETED);
  });

  it.each([SupportIssueInternalState.COMPLETED, SupportIssueInternalState.CANCELED])(
    'is idempotent for already-closed issues (%s: no write, no log)',
    async (state) => {
      supportIssueRepo.findOne.mockResolvedValue(makeIssue(state));
      await service.closeIssue('7', 42);
      expect(supportIssueRepo.update).not.toHaveBeenCalled();
      expect(supportLogService.createSupportLog).not.toHaveBeenCalled();
    },
  );

  it('loads messages so the response matches GET /:id instead of an empty thread', async () => {
    supportIssueRepo.findOne.mockResolvedValue(makeIssue(SupportIssueInternalState.PENDING));
    await service.closeIssue('7', 42);
    expect(messageRepo.findBy).toHaveBeenCalledWith({ issue: { id: 7 } });
  });
});

describe('SupportIssueService.getSupportIssueStatistics', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;

  let trendRows: { d: Date; count: string }[];
  let resolvedRows: { type: SupportIssueType; created: Date; updated: Date }[];
  let totalCount: number;
  let andWhereClauses: string[];
  // when true, the total/message getRawOne resolves undefined instead of a count row, exercising the
  // `?.count ?? 0` fallback on both the total and message sub-queries
  let rawOneEmpty: boolean;

  const pad = (n: number): string => String(n).padStart(2, '0');
  const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // a Postgres DATE comes back from the pg driver as a JS Date at local midnight
  const localDate = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // the day-grouped trend query (the one calling groupBy) returns trendRows, the ungrouped resolution query
  // returns resolvedRows; getRawOne returns the configured count; andWhere clauses are recorded for scoping
  function statsQbMock(): Record<string, jest.Mock> {
    let grouped = false;
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['select', 'addSelect', 'innerJoin', 'where', 'addGroupBy']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.andWhere = jest.fn((clause: string) => {
      andWhereClauses.push(clause);
      return qb;
    });
    qb.groupBy = jest.fn(() => {
      grouped = true;
      return qb;
    });
    qb.getRawOne = jest.fn(() => Promise.resolve(rawOneEmpty ? undefined : { count: String(totalCount) }));
    qb.getRawMany = jest.fn(() => Promise.resolve(grouped ? trendRows : resolvedRows));
    return qb;
  }

  beforeEach(() => {
    trendRows = [];
    resolvedRows = [];
    totalCount = 0;
    andWhereClauses = [];
    rawOneEmpty = false;
    supportIssueRepo = createMock<SupportIssueRepository>();
    const messageRepo = createMock<SupportMessageRepository>();
    (supportIssueRepo.createQueryBuilder as jest.Mock).mockImplementation(() => statsQbMock());
    (messageRepo.createQueryBuilder as jest.Mock).mockImplementation(() => statsQbMock());

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      messageRepo,
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  it('builds a daily bucket for every calendar day the window touches', async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 7);

    expect(dto.granularity).toBe('day');
    // the trend spans from's calendar day through today, contiguously (asserting the span, not a fixed
    // count, keeps this correct under any DST/timezone shift in the window)
    expect(dto.trend[0].key).toBe(dayKey(from));
    expect(dto.trend[dto.trend.length - 1].key).toBe(dayKey(now));
    expect(dto.total).toBe(0);
  });

  it('places daily counts in their calendar-day buckets and sums to total', async () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    trendRows = [
      { d: localDate(today), count: '3' },
      { d: localDate(yesterday), count: '2' },
    ];
    totalCount = 5;

    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 7);

    const byKey = Object.fromEntries(dto.trend.map((b) => [b.key, b.count]));
    expect(byKey[dayKey(today)]).toBe(3);
    expect(byKey[dayKey(yesterday)]).toBe(2);
    expect(dto.total).toBe(5);
    expect(dto.trend.reduce((sum, b) => sum + b.count, 0)).toBe(dto.total);
  });

  it('switches to monthly granularity for long periods', async () => {
    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 365);
    expect(dto.granularity).toBe('month');
    expect(dto.trend.length).toBeGreaterThanOrEqual(12);
  });

  it('rolls daily rows up into their month buckets and sums to total', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    trendRows = [
      { d: thisMonth, count: '4' },
      { d: lastMonth, count: '3' },
    ];
    totalCount = 7;

    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 365);

    const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const byKey = Object.fromEntries(dto.trend.map((b) => [b.key, b.count]));
    expect(byKey[monthKey(thisMonth)]).toBe(4);
    expect(byKey[monthKey(lastMonth)]).toBe(3);
    expect(dto.trend.reduce((sum, b) => sum + b.count, 0)).toBe(dto.total);
  });

  it('falls back to the default period for a non-numeric days value', async () => {
    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, NaN);
    expect(dto.periodDays).toBe(365);
    expect(dto.granularity).toBe('month');
  });

  it('defaults periodDays to 365 when the caller omits it entirely', async () => {
    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN);
    expect(dto.periodDays).toBe(365);
    expect(dto.granularity).toBe('month');
  });

  it('treats a missing total/message count row as zero (defensive `?.count ?? 0` fallback)', async () => {
    rawOneEmpty = true;
    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 7);
    expect(dto.total).toBe(0);
    expect(dto.avgMessages).toBe(0);
  });

  it('averages resolution time per type for tickets completed in the period', async () => {
    resolvedRows = [
      {
        type: SupportIssueType.GENERIC_ISSUE,
        created: new Date('2026-06-01T00:00:00Z'),
        updated: new Date('2026-06-01T02:00:00Z'),
      },
      {
        type: SupportIssueType.GENERIC_ISSUE,
        created: new Date('2026-06-02T00:00:00Z'),
        updated: new Date('2026-06-02T04:00:00Z'),
      },
      {
        type: SupportIssueType.KYC_ISSUE,
        created: new Date('2026-06-03T00:00:00Z'),
        updated: new Date('2026-06-03T01:00:00Z'),
      },
    ];

    const dto = await service.getSupportIssueStatistics(UserRole.ADMIN, 7);

    const byType = Object.fromEntries(dto.resolutionByType.map((r) => [r.key, r]));
    expect(byType[SupportIssueType.GENERIC_ISSUE]).toEqual({
      key: SupportIssueType.GENERIC_ISSUE,
      avgHours: 3,
      count: 2,
    });
    expect(byType[SupportIssueType.KYC_ISSUE]).toEqual({ key: SupportIssueType.KYC_ISSUE, avgHours: 1, count: 1 });
    // count-weighted overall mean = (2h + 4h + 1h) / 3 tickets
    expect(dto.avgResolutionHours).toBeCloseTo(7 / 3);
  });

  it('scopes the statistics queries to the departments a non-admin role may view', async () => {
    await service.getSupportIssueStatistics(UserRole.SUPPORT, 7);
    expect(andWhereClauses.some((c) => c.includes('issue.department IN (:...departments)'))).toBe(true);
  });

  it('does not department-scope for an all-access role', async () => {
    await service.getSupportIssueStatistics(UserRole.ADMIN, 7);
    expect(andWhereClauses.some((c) => c.includes('issue.department'))).toBe(false);
  });

  // customerIds (RealUnit tenant scope) takes precedence over the department gate on every one of the
  // four sub-queries (total / messages / trend / resolution) and joins through userData instead.
  it('scopes every statistics sub-query to customerIds via innerJoin, bypassing the department gate', async () => {
    await service.getSupportIssueStatistics(UserRole.SUPPORT, 7, [1, 2, 3]);
    expect(andWhereClauses.filter((c) => c.includes('scopeUd.id IN (:...customerIds)')).length).toBe(4);
    expect(andWhereClauses.some((c) => c.includes('issue.department IN'))).toBe(false);
  });

  it('returns an empty, unqueried statistic for a role with no department access', async () => {
    const dto = await service.getSupportIssueStatistics(UserRole.USER, 7);
    expect(dto.total).toBe(0);
    expect(dto.trend).toEqual([]);
    expect(dto.resolutionByType).toEqual([]);
    expect(dto.avgResolutionHours).toBe(0);
    expect(supportIssueRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

// the count / activity endpoints share the same fail-closed guard as list / statistics: a role with no
// department access gets an empty result without ever touching the database
describe('SupportIssueService no-department-access guards', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let messageRepo: DeepMocked<SupportMessageRepository>;

  beforeEach(() => {
    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      messageRepo,
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  it('getSupportIssueCounts returns an all-zero, unqueried record', async () => {
    const counts = await service.getSupportIssueCounts(UserRole.USER);
    const zero = Object.fromEntries(Object.values(SupportIssueInternalState).map((s) => [s, 0]));
    expect(counts).toEqual(zero);
    expect(supportIssueRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('getSupportIssueActivity returns empty activity without querying', async () => {
    const activity = await service.getSupportIssueActivity(undefined, UserRole.USER);
    expect(activity).toEqual({ count: 0, latestAt: undefined });
    expect(messageRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('SupportIssueService.getIssueMessages', () => {
  let service: SupportIssueService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let messageRepo: DeepMocked<SupportMessageRepository>;

  const issueOfCustomer = (userDataId: number): SupportIssue =>
    Object.assign(new SupportIssue(), { id: 7, userData: { id: userDataId } as UserData });

  const message = (id: number): SupportMessage =>
    Object.assign(new SupportMessage(), {
      id,
      author: 'Customer',
      message: `msg ${id}`,
      created: new Date('2026-01-01T00:00:00.000Z'),
    });

  beforeEach(() => {
    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();

    service = new SupportIssueService(
      supportIssueRepo,
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      createMock<UserDataService>(),
      messageRepo,
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      createMock<WalletService>(),
    );
  });

  it('throws NotFound when the issue does not exist', async () => {
    supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(service.getIssueMessages(7, [42])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound (fail-closed) when the issue owner is outside the customer scope, without reading messages', async () => {
    supportIssueRepo.findOne.mockResolvedValue(issueOfCustomer(99));
    await expect(service.getIssueMessages(7, [42])).rejects.toBeInstanceOf(NotFoundException);
    expect(messageRepo.findBy).not.toHaveBeenCalled();
  });

  it('returns the mapped thread for an in-scope customer, honoring fromMessageId', async () => {
    supportIssueRepo.findOne.mockResolvedValue(issueOfCustomer(42));
    messageRepo.findBy.mockResolvedValue([message(11), message(12)]);

    const result = await service.getIssueMessages(7, [42], 10);

    const findByArg = messageRepo.findBy.mock.calls[0][0] as { issue: { id: number }; id: { value: number } };
    expect(findByArg.issue).toEqual({ id: 7 });
    expect(findByArg.id.value).toBe(10); // MoreThan(10)
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 11, author: 'Customer', message: 'msg 11' });
  });

  it('defaults fromMessageId to 0 when omitted, returning the full thread', async () => {
    supportIssueRepo.findOne.mockResolvedValue(issueOfCustomer(42));
    messageRepo.findBy.mockResolvedValue([message(1)]);

    await service.getIssueMessages(7, [42]);

    const findByArg = messageRepo.findBy.mock.calls[0][0] as { id: { value: number } };
    expect(findByArg.id.value).toBe(0);
  });
});

describe('SupportIssueService.resolveSourceWallet (X-Client mail branding)', () => {
  let service: SupportIssueService;
  let walletService: DeepMocked<WalletService>;
  let userDataService: DeepMocked<UserDataService>;

  const dfxDefault = { id: 1, name: 'DFX' } as Wallet;
  const realUnit = { id: 2, name: REALUNIT_WALLET_NAME } as Wallet;

  // resolveSourceWallet is private; exercise it directly to isolate the branding decision.
  const resolve = (client?: string): Promise<Wallet> =>
    (service as unknown as { resolveSourceWallet(client?: string): Promise<Wallet> }).resolveSourceWallet(client);

  beforeEach(() => {
    walletService = createMock<WalletService>();
    walletService.getDefault.mockResolvedValue(dfxDefault);
    walletService.getByIdOrName.mockResolvedValue(realUnit);
    userDataService = createMock<UserDataService>();

    service = new SupportIssueService(
      createMock<SupportIssueRepository>(),
      createMock<TransactionService>(),
      createMock<SupportDocumentService>(),
      userDataService,
      createMock<SupportMessageRepository>(),
      createMock<SupportIssueNotificationService>(),
      createMock<LimitRequestService>(),
      createMock<TransactionRequestService>(),
      createMock<SupportLogService>(),
      createMock<BankDataService>(),
      createMock<SettingService>(),
      walletService,
    );
  });

  it('brands the realunit-app client with the RealUnit wallet', async () => {
    await expect(resolve('realunit-app')).resolves.toBe(realUnit);
    expect(walletService.getByIdOrName).toHaveBeenCalledWith(undefined, REALUNIT_WALLET_NAME);
    expect(walletService.getDefault).not.toHaveBeenCalled();
  });

  // A missing/unknown header must NOT reject the request - it defaults to DFX. This is the behavior the
  // DFX web app, third-party widget integrators and older bundles rely on (none of them send X-Client).
  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['the dfx-services client', 'dfx-services'],
    ['an unknown client', 'some-other-app'],
  ])('defaults to the DFX wallet for %s', async (_label, client) => {
    await expect(resolve(client as string | undefined)).resolves.toBe(dfxDefault);
    expect(walletService.getByIdOrName).not.toHaveBeenCalled();
  });

  it('fails closed when the RealUnit source resolves but its wallet is missing', async () => {
    walletService.getByIdOrName.mockResolvedValue(null as unknown as Wallet);
    await expect(resolve('realunit-app')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // End-to-end regression for the production outage: the DFX web app POSTs /support/issue with no
  // X-Client header. createIssue must route through to ticket creation (no BadRequestException) and
  // brand the ticket with the DFX default wallet.
  it('creates a ticket with DFX branding when the request carries no X-Client header', async () => {
    const userData = { id: 42, mail: 'willi@example.com' } as UserData;
    userDataService.getUserData.mockResolvedValue(userData);

    const created = { uid: 'issue-1' } as SupportIssueDto;
    const createIssueInternal = jest.spyOn(service, 'createIssueInternal').mockResolvedValue(created);

    const dto = { type: SupportIssueType.GENERIC_ISSUE, reason: SupportIssueReason.OTHER } as CreateSupportIssueDto;

    // no client argument == the missing X-Client header on the real request
    await expect(service.createIssue(42, dto)).resolves.toBe(created);

    // routed to creation with the DFX default wallet (not RealUnit, and never rejected)
    expect(createIssueInternal).toHaveBeenCalledWith(userData, dto, dfxDefault);
    expect(walletService.getByIdOrName).not.toHaveBeenCalled();
  });
});

describe('SupportIssueService clerk settings', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('getSupportIssueClerks returns the configured list when non-empty', async () => {
    ctx.settingService.getObj.mockResolvedValue(['Alice', 'Bob']);
    await expect(ctx.service.getSupportIssueClerks()).resolves.toEqual(['Alice', 'Bob']);
    expect(ctx.settingService.getObj).toHaveBeenCalledWith('supportClerks', []);
  });

  it('getSupportIssueClerks falls back to ["Support"] when the setting is empty', async () => {
    ctx.settingService.getObj.mockResolvedValue([]);
    await expect(ctx.service.getSupportIssueClerks()).resolves.toEqual(['Support']);
  });

  it('getRealUnitSupportClerks returns the configured list when non-empty', async () => {
    ctx.settingService.getObj.mockResolvedValue(['Carol']);
    await expect(ctx.service.getRealUnitSupportClerks()).resolves.toEqual(['Carol']);
    expect(ctx.settingService.getObj).toHaveBeenCalledWith('realUnitSupportClerks', []);
  });

  it('getRealUnitSupportClerks falls back to ["Support"] when the setting is empty', async () => {
    ctx.settingService.getObj.mockResolvedValue([]);
    await expect(ctx.service.getRealUnitSupportClerks()).resolves.toEqual(['Support']);
  });

  it('getSupportIssueClerkForAccount resolves the mapped clerk name', async () => {
    ctx.settingService.getObj.mockResolvedValue([
      { account: 42, name: 'Alice' },
      { account: 7, name: 'Bob' },
    ] as SupportClerkAccountDto[]);
    await expect(ctx.service.getSupportIssueClerkForAccount(7)).resolves.toBe('Bob');
  });

  it('getSupportIssueClerkForAccount returns undefined for an unmapped account', async () => {
    ctx.settingService.getObj.mockResolvedValue([{ account: 42, name: 'Alice' }] as SupportClerkAccountDto[]);
    await expect(ctx.service.getSupportIssueClerkForAccount(99)).resolves.toBeUndefined();
  });
});

describe('SupportIssueService.getSupportIssueActivity', () => {
  let ctx: ReturnType<typeof buildService>;
  let qb: Record<string, jest.Mock>;

  function createActivityQbMock(): Record<string, jest.Mock> {
    const builder: Record<string, jest.Mock> = {};
    for (const method of ['innerJoin', 'select', 'addSelect', 'andWhere']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawOne = jest.fn().mockResolvedValue(undefined);
    return builder;
  }

  const andWhereClauses = (): string[] => qb.andWhere.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    ctx = buildService();
    qb = createActivityQbMock();
    (ctx.messageRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
  });

  it('returns empty activity without querying for an empty customerIds scope (fail-closed)', async () => {
    const result = await ctx.service.getSupportIssueActivity(undefined, UserRole.ADMIN, []);
    expect(result).toEqual({ count: 0, latestAt: undefined });
    expect(ctx.messageRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('adds a since lower bound and reports the raw count/latestAt when provided', async () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    qb.getRawOne.mockResolvedValue({ count: '3', latestAt: new Date('2026-01-02T00:00:00.000Z') });

    const result = await ctx.service.getSupportIssueActivity(since, UserRole.ADMIN);

    expect(qb.andWhere).toHaveBeenCalledWith('m.created > :since', { since: since.toISOString() });
    expect(result).toEqual({ count: 3, latestAt: new Date('2026-01-02T00:00:00.000Z') });
  });

  it('omits the since clause when absent', async () => {
    await ctx.service.getSupportIssueActivity(undefined, UserRole.ADMIN);
    expect(andWhereClauses().some((c) => c.includes('m.created >'))).toBe(false);
  });

  it('scopes to customerIds via innerJoin when provided (RealUnit tenant scope)', async () => {
    await ctx.service.getSupportIssueActivity(undefined, UserRole.SUPPORT, [1, 2]);
    expect(qb.innerJoin).toHaveBeenCalledWith('i.userData', 'scopeUd');
    expect(qb.andWhere).toHaveBeenCalledWith('scopeUd.id IN (:...customerIds)', { customerIds: [1, 2] });
  });

  it('scopes to the allowed departments when no customerIds are given', async () => {
    await ctx.service.getSupportIssueActivity(undefined, UserRole.SUPPORT);
    expect(andWhereClauses().some((c) => c.includes('i.department IN'))).toBe(true);
  });

  it('defaults to count 0 / latestAt undefined when the raw query yields nothing', async () => {
    qb.getRawOne.mockResolvedValue(undefined);
    const result = await ctx.service.getSupportIssueActivity(undefined, UserRole.ADMIN);
    expect(result).toEqual({ count: 0, latestAt: undefined });
  });
});

describe('SupportIssueService.createTransactionRequestIssue', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws BadRequest when the dto carries no orderUid', async () => {
    await expect(ctx.service.createTransactionRequestIssue({} as CreateSupportIssueBaseDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound when the transaction request does not exist', async () => {
    ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue(null);
    const dto = { transaction: { orderUid: 'Q1' } } as CreateSupportIssueBaseDto;
    await expect(ctx.service.createTransactionRequestIssue(dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the issue for the transaction request owner, branded via the resolved source wallet', async () => {
    const dfxDefault = { id: 1, name: 'DFX' } as Wallet;
    ctx.walletService.getDefault.mockResolvedValue(dfxDefault);
    const requestUserData = { id: 42 } as UserData;
    ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({ userData: requestUserData } as any);
    const created = { uid: 'i1' } as SupportIssueDto;
    const createIssueInternal = jest.spyOn(ctx.service, 'createIssueInternal').mockResolvedValue(created);

    const dto = { transaction: { orderUid: 'Q1' } } as CreateSupportIssueBaseDto;
    const result = await ctx.service.createTransactionRequestIssue(dto, 'unknown-client');

    expect(ctx.transactionRequestService.getTransactionRequestByUid).toHaveBeenCalledWith('Q1', {
      user: { userData: true },
    });
    expect(createIssueInternal).toHaveBeenCalledWith(requestUserData, dto, dfxDefault);
    expect(result).toBe(created);
  });
});

describe('SupportIssueService.createIssueBySupport', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws NotFound when the userData does not exist', async () => {
    ctx.userDataService.getUserData.mockResolvedValue(null);
    await expect(ctx.service.createIssueBySupport(42, {} as CreateSupportIssueDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates the issue for the given userData, always branded with the DFX default wallet (never the request client)', async () => {
    const userData = { id: 42, mail: 'x@example.com' } as UserData;
    ctx.userDataService.getUserData.mockResolvedValue(userData);
    const dfxDefault = { id: 1, name: 'DFX' } as Wallet;
    ctx.walletService.getDefault.mockResolvedValue(dfxDefault);
    const created = { uid: 'i1' } as SupportIssueDto;
    const createIssueInternal = jest.spyOn(ctx.service, 'createIssueInternal').mockResolvedValue(created);

    const dto = { type: SupportIssueType.GENERIC_ISSUE, reason: SupportIssueReason.OTHER } as CreateSupportIssueDto;
    const result = await ctx.service.createIssueBySupport(42, dto);

    expect(ctx.userDataService.getUserData).toHaveBeenCalledWith(42, { wallet: true });
    expect(createIssueInternal).toHaveBeenCalledWith(userData, dto, dfxDefault);
    expect(ctx.walletService.getByIdOrName).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });
});

describe('SupportIssueService.createIssueInternal', () => {
  let ctx: ReturnType<typeof buildService>;
  let createMessageInternalSpy: jest.SpyInstance;

  const sourceWallet = { id: 1, name: 'DFX' } as Wallet;
  const message = { id: 99, author: 'Customer', message: 'hi' } as SupportMessageDto;

  const baseUserData = (overrides: Partial<UserData> = {}): UserData =>
    ({ id: 42, mail: 'user@example.com', ...overrides }) as UserData;

  const baseDto = (overrides: Partial<CreateSupportIssueDto> = {}): CreateSupportIssueDto =>
    ({
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      name: 'Help',
      ...overrides,
    }) as CreateSupportIssueDto;

  beforeEach(() => {
    ctx = buildService();
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { issueUidPrefix: 'I', quoteUidPrefix: 'Q', transactionUidPrefix: 'T' },
    };
    ctx.supportIssueRepo.create.mockImplementation((obj: Partial<SupportIssue>) =>
      Object.assign(new SupportIssue(), obj),
    );
    ctx.supportIssueRepo.save.mockImplementation(async (x: SupportIssue) => x);
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    createMessageInternalSpy = jest.spyOn(ctx.service, 'createMessageInternal').mockResolvedValue(message);
  });

  it('throws BadRequest when the userData has no mail', async () => {
    await expect(
      ctx.service.createIssueInternal(baseUserData({ mail: undefined }), baseDto(), sourceWallet),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('existing-issue lookup scope', () => {
    it('scopes to open issues (state != Completed) when the dto carries a limitRequest', async () => {
      const dto = baseDto({ type: SupportIssueType.LIMIT_REQUEST, limitRequest: { limit: 1000 } as any });
      await ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet);
      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as {
        state: { type: string; value: unknown };
      };
      expect(where.state.type).toBe('not');
      expect(where.state.value).toBe(SupportIssueInternalState.COMPLETED);
    });

    it('leaves state unrestricted when the dto carries no limitRequest', async () => {
      await ctx.service.createIssueInternal(baseUserData(), baseDto(), sourceWallet);
      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as { state: unknown };
      expect(where.state).toBeUndefined();
    });
  });

  describe('transaction / transactionRequest resolution (new issue)', () => {
    it('matches an existing transaction by id, scopes the existing-issue lookup to it, and links it when owned by the same userData', async () => {
      const userData = baseUserData();
      const transaction = {
        id: 5,
        userData: { id: userData.id },
        sourceType: TransactionSourceType.CRYPTO_INPUT,
      } as any;
      ctx.transactionService.getTransactionById.mockResolvedValue(transaction);
      const dto = baseDto({ transaction: { id: 5 } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as { transaction: unknown };
      expect(where.transaction).toEqual({ id: 5, uid: undefined });
      expect(ctx.transactionService.getTransactionById).toHaveBeenCalledWith(5, { userData: true });
      const saved = ctx.supportIssueRepo.save.mock.calls[0][0] as SupportIssue;
      expect(saved.transaction).toBe(transaction);
    });

    it('matches an existing transaction by uid when it carries the transaction prefix (no id given)', async () => {
      const userData = baseUserData();
      ctx.transactionService.getTransactionByUid.mockResolvedValue({ id: 6, userData: { id: userData.id } } as any);
      const dto = baseDto({ transaction: { uid: 'Tabc' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as { transaction: unknown };
      expect(where.transaction).toEqual({ id: undefined, uid: 'Tabc' });
      expect(ctx.transactionService.getTransactionByUid).toHaveBeenCalledWith('Tabc', { userData: true });
    });

    it('throws NotFound when the referenced transaction does not exist', async () => {
      ctx.transactionService.getTransactionById.mockResolvedValue(null);
      const dto = baseDto({ transaction: { id: 5 } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toThrow(
        'Transaction not found',
      );
    });

    it('throws Forbidden when the referenced transaction belongs to another userData', async () => {
      ctx.transactionService.getTransactionById.mockResolvedValue({ id: 5, userData: { id: 999 } } as any);
      const dto = baseDto({ transaction: { id: 5 } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toThrow(
        'You can only create support issue for your own transaction',
      );
    });

    it('throws Forbidden when the referenced transaction has no userData at all', async () => {
      ctx.transactionService.getTransactionById.mockResolvedValue({ id: 5, userData: undefined } as any);
      const dto = baseDto({ transaction: { id: 5 } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('matches an existing transactionRequest by orderUid, scopes the existing-issue lookup to it, and links its nested transaction', async () => {
      const userData = baseUserData();
      const nestedTransaction = { id: 8 } as any;
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({
        user: { userData: { id: userData.id } },
        transaction: nestedTransaction,
      } as any);
      const dto = baseDto({ transaction: { orderUid: 'Qabc' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as { transactionRequest: unknown };
      expect(where.transactionRequest).toEqual({ uid: 'Qabc' });
      expect(ctx.transactionRequestService.getTransactionRequestByUid).toHaveBeenCalledWith('Qabc', {
        user: { userData: true },
        transaction: true,
      });
      const saved = ctx.supportIssueRepo.save.mock.calls[0][0] as SupportIssue;
      expect(saved.transaction).toBe(nestedTransaction);
    });

    // `newIssue` is seeded via `supportIssueRepo.create({ ...dto })`, which copies dto.transaction (the raw
    // TransactionIssueDto) onto the entity's `transaction` field before any resolution runs; only a nested
    // `transactionRequest.transaction` overwrites it with a real Transaction. Without one, that raw seed value
    // is what ends up on the saved entity - pinning this (surprising but real) behavior rather than asserting
    // the naively-expected `undefined`.
    it('matches an existing transactionRequest by uid when it carries the quote prefix, without a nested transaction to link', async () => {
      const userData = baseUserData();
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({
        user: { userData: { id: userData.id } },
      } as any);
      const dto = baseDto({ transaction: { uid: 'Qxyz' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as { transactionRequest: unknown };
      expect(where.transactionRequest).toEqual({ uid: 'Qxyz' });
      const saved = ctx.supportIssueRepo.save.mock.calls[0][0] as SupportIssue;
      expect(saved.transaction).toEqual({ uid: 'Qxyz' });
    });

    it('throws NotFound when the referenced quote does not exist', async () => {
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue(null);
      const dto = baseDto({ transaction: { orderUid: 'Qabc' } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toThrow(
        'Quote not found',
      );
    });

    it('throws Forbidden when the referenced quote belongs to another userData', async () => {
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({
        user: { userData: { id: 999 } },
      } as any);
      const dto = baseDto({ transaction: { orderUid: 'Qabc' } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toThrow(
        'You can only create support issue for your own quote',
      );
    });

    it('throws Forbidden when the referenced quote has no user at all', async () => {
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({ user: undefined } as any);
      const dto = baseDto({ transaction: { orderUid: 'Qabc' } as any });
      await expect(ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('skips transaction/request lookups and scopes to an "IsNull" existing-issue match when dto.transaction matches neither shape', async () => {
      const dto = baseDto({ transaction: { senderIban: 'CH930076000000000000' } as any });

      await ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet);

      const where = ctx.supportIssueRepo.findOne.mock.calls[0][0].where as {
        transaction: { id: { type: string } };
        transactionRequest: { id: { type: string } };
      };
      expect(where.transaction.id.type).toBe('isNull');
      expect(where.transactionRequest.id.type).toBe('isNull');
      expect(ctx.transactionService.getTransactionById).not.toHaveBeenCalled();
      expect(ctx.transactionRequestService.getTransactionRequestByUid).not.toHaveBeenCalled();
    });
  });

  describe('user bank data creation from a senderIban', () => {
    it('creates the iban when the linked transaction is a bank transaction', async () => {
      const userData = baseUserData();
      ctx.transactionService.getTransactionById.mockResolvedValue({
        id: 5,
        userData: { id: userData.id },
        sourceType: TransactionSourceType.BANK_TX,
      } as any);
      const dto = baseDto({ transaction: { id: 5, senderIban: 'CH930076000000000000' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.bankDataService.createIbanForUserInternal).toHaveBeenCalledWith(
        userData,
        { iban: 'CH930076000000000000' },
        false,
      );
    });

    it('creates the iban when the linked transactionRequest is a Buy quote', async () => {
      const userData = baseUserData();
      ctx.transactionRequestService.getTransactionRequestByUid.mockResolvedValue({
        user: { userData: { id: userData.id } },
        type: TransactionRequestType.BUY,
      } as any);
      const dto = baseDto({ transaction: { orderUid: 'Qabc', senderIban: 'CH930076000000000000' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.bankDataService.createIbanForUserInternal).toHaveBeenCalledWith(
        userData,
        { iban: 'CH930076000000000000' },
        false,
      );
    });

    it('does not create the iban when neither the transaction nor the quote condition applies', async () => {
      const userData = baseUserData();
      ctx.transactionService.getTransactionById.mockResolvedValue({
        id: 5,
        userData: { id: userData.id },
        sourceType: TransactionSourceType.REF,
      } as any);
      const dto = baseDto({ transaction: { id: 5, senderIban: 'CH930076000000000000' } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.bankDataService.createIbanForUserInternal).not.toHaveBeenCalled();
    });

    it('does not attempt an iban when senderIban is absent', async () => {
      const userData = baseUserData();
      ctx.transactionService.getTransactionById.mockResolvedValue({ id: 5, userData: { id: userData.id } } as any);
      const dto = baseDto({ transaction: { id: 5 } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.bankDataService.createIbanForUserInternal).not.toHaveBeenCalled();
    });

    it('swallows an error creating the bank data, without failing the issue creation', async () => {
      const userData = baseUserData();
      ctx.transactionService.getTransactionById.mockResolvedValue({
        id: 5,
        userData: { id: userData.id },
        sourceType: TransactionSourceType.BANK_TX,
      } as any);
      ctx.bankDataService.createIbanForUserInternal.mockRejectedValue(new Error('boom'));
      const dto = baseDto({ transaction: { id: 5, senderIban: 'CH930076000000000000' } as any });

      await expect(ctx.service.createIssueInternal(userData, dto, sourceWallet)).resolves.toBeDefined();
    });
  });

  describe('limit request creation', () => {
    it('creates the limit request and links it to the new issue', async () => {
      const limitRequest = { id: 3, limit: 5000 } as any;
      ctx.limitRequestService.increaseLimitInternal.mockResolvedValue(limitRequest);
      const userData = baseUserData();
      const dto = baseDto({ type: SupportIssueType.LIMIT_REQUEST, limitRequest: { limit: 5000 } as any });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.limitRequestService.increaseLimitInternal).toHaveBeenCalledWith(dto.limitRequest, userData);
      const saved = ctx.supportIssueRepo.save.mock.calls[0][0] as SupportIssue;
      expect(saved.limitRequest).toBe(limitRequest);
    });

    it('does not create a limit request when the dto carries none', async () => {
      await ctx.service.createIssueInternal(baseUserData(), baseDto(), sourceWallet);
      expect(ctx.limitRequestService.increaseLimitInternal).not.toHaveBeenCalled();
    });
  });

  describe('phone call status update for a rejected/repeated verification call', () => {
    it.each([
      [SupportIssueReason.REJECT_CALL, PhoneCallStatus.USER_REJECTED],
      [SupportIssueReason.REPEAT_CALL, PhoneCallStatus.REPEAT],
    ])('maps reason %s to phoneCallStatus %s when the user has none yet', async (reason, expectedStatus) => {
      const userData = baseUserData({ phoneCallStatus: undefined });
      const dto = baseDto({ type: SupportIssueType.VERIFICATION_CALL, reason });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.userDataService.updateUserDataInternal).toHaveBeenCalledWith(userData, {
        phoneCallStatus: expectedStatus,
      });
    });

    it('does not update when the user already has a phoneCallStatus', async () => {
      const userData = baseUserData({ phoneCallStatus: PhoneCallStatus.COMPLETED });
      const dto = baseDto({ type: SupportIssueType.VERIFICATION_CALL, reason: SupportIssueReason.REJECT_CALL });

      await ctx.service.createIssueInternal(userData, dto, sourceWallet);

      expect(ctx.userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });

    it('does not update for a non-verification-call issue type', async () => {
      const dto = baseDto({ type: SupportIssueType.GENERIC_ISSUE, reason: SupportIssueReason.REJECT_CALL });
      await ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet);
      expect(ctx.userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });

    it('does not update for a verification call with an unrelated reason', async () => {
      const dto = baseDto({ type: SupportIssueType.VERIFICATION_CALL, reason: SupportIssueReason.OTHER });
      await ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet);
      expect(ctx.userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });
  });

  describe('existing-issue reuse', () => {
    it('reuses the existing issue without saving a new one or re-running transaction/limitRequest resolution', async () => {
      const existing = Object.assign(new SupportIssue(), {
        id: 9,
        uid: 'Iexisting123',
        wallet: sourceWallet,
        userData: baseUserData(),
      });
      ctx.supportIssueRepo.findOne.mockResolvedValue(existing);
      const dto = baseDto({
        transaction: { id: 5 } as any,
        limitRequest: { limit: 1 } as any,
        type: SupportIssueType.LIMIT_REQUEST,
      });

      const issue = await ctx.service.createIssueInternal(baseUserData(), dto, sourceWallet);

      expect(ctx.supportIssueRepo.save).not.toHaveBeenCalled();
      expect(ctx.transactionService.getTransactionById).not.toHaveBeenCalled();
      expect(ctx.limitRequestService.increaseLimitInternal).not.toHaveBeenCalled();
      expect(issue.uid).toBe('Iexisting123');
    });

    it('backfills a missing wallet attribution on the existing issue, without rebranding an already-attributed one', async () => {
      const existing = Object.assign(new SupportIssue(), { id: 9, wallet: undefined, userData: baseUserData() });
      ctx.supportIssueRepo.findOne.mockResolvedValue(existing);

      await ctx.service.createIssueInternal(baseUserData(), baseDto(), sourceWallet);

      expect(existing.wallet).toBe(sourceWallet);
      expect(ctx.supportIssueRepo.update).toHaveBeenCalledWith(9, { wallet: sourceWallet });
    });

    it('does not touch the wallet when the existing issue is already attributed', async () => {
      const otherWallet = { id: 2, name: 'RealUnit' } as Wallet;
      const existing = Object.assign(new SupportIssue(), { id: 9, wallet: otherWallet, userData: baseUserData() });
      ctx.supportIssueRepo.findOne.mockResolvedValue(existing);

      await ctx.service.createIssueInternal(baseUserData(), baseDto(), sourceWallet);

      expect(existing.wallet).toBe(otherWallet);
      expect(ctx.supportIssueRepo.update).not.toHaveBeenCalled();
    });
  });

  it('creates a UID-tagged new issue, delegates message creation to createMessageInternal, and returns it with the message attached', async () => {
    const userData = baseUserData();
    const dto = baseDto();

    const issue = await ctx.service.createIssueInternal(userData, dto, sourceWallet);

    const saved = ctx.supportIssueRepo.save.mock.calls[0][0] as SupportIssue;
    expect(saved.uid).toMatch(/^I/);
    expect(createMessageInternalSpy).toHaveBeenCalledWith(saved, dto);
    expect(issue.messages).toContainEqual(expect.objectContaining({ id: 99, author: 'Customer' }));
  });
});

describe('SupportIssueService.updateIssue / updateIssueInternal', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws NotFound when the entity does not exist', async () => {
    ctx.supportIssueRepo.findOneBy.mockResolvedValue(null);
    await expect(ctx.service.updateIssue(1, {} as UpdateSupportIssueDto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('logs the change as a SUPPORT support log, persists state/clerk/department, and returns the merged entity', async () => {
    const entity = Object.assign(new SupportIssue(), {
      id: 3,
      userData: { id: 42 } as UserData,
      clerk: 'Old',
      state: SupportIssueInternalState.PENDING,
    });
    ctx.supportIssueRepo.findOneBy.mockResolvedValue(entity);

    const dto = {
      state: SupportIssueInternalState.IN_PROGRESS,
      clerk: 'Alice',
      department: Department.SUPPORT,
      type: SupportIssueType.GENERIC_ISSUE,
    } as UpdateSupportIssueDto;
    const result = await ctx.service.updateIssue(3, dto);

    expect(ctx.supportLogService.createSupportLog).toHaveBeenCalledWith(
      entity.userData,
      expect.objectContaining({
        supportIssue: entity,
        supportIssueType: dto.type,
        type: SupportLogType.SUPPORT,
        state: dto.state,
        clerk: dto.clerk,
      }),
    );
    expect(ctx.supportIssueRepo.update).toHaveBeenCalledWith(3, {
      state: dto.state,
      clerk: dto.clerk,
      department: dto.department,
    });
    expect(result.clerk).toBe('Alice');
    expect(result.state).toBe(SupportIssueInternalState.IN_PROGRESS);
  });
});

describe('SupportIssueService.createMessage', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { issueUidPrefix: 'I', quoteUidPrefix: 'Q' },
    };
  });

  it('throws NotFound when the issue does not exist', async () => {
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(
      ctx.service.createMessage('I123', { message: 'hi' } as CreateSupportMessageDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tags the message with the fixed CustomerAuthor, overriding any caller-supplied author', async () => {
    const issue = Object.assign(new SupportIssue(), { id: 7, uid: 'I123' });
    ctx.supportIssueRepo.findOne.mockResolvedValue(issue);
    const created = { id: 1, author: CustomerAuthor, message: 'hi' } as SupportMessageDto;
    const createMessageInternal = jest.spyOn(ctx.service, 'createMessageInternal').mockResolvedValue(created);

    const dto = { author: 'someone-else', message: 'hi' } as CreateSupportMessageDto;
    const result = await ctx.service.createMessage('I123', dto, 42);

    expect(createMessageInternal).toHaveBeenCalledWith(issue, { ...dto, author: CustomerAuthor });
    expect(result).toBe(created);
  });
});

describe('SupportIssueService.createMessageSupport', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws NotFound when the issue does not exist', async () => {
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(
      ctx.service.createMessageSupport(7, { author: 'Alice', message: 'hi' } as CreateSupportMessageDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the message by numeric issue id, preserving the caller-supplied (staff) author', async () => {
    const issue = Object.assign(new SupportIssue(), { id: 7 });
    ctx.supportIssueRepo.findOne.mockResolvedValue(issue);
    const created = { id: 1, author: 'Alice', message: 'hi' } as SupportMessageDto;
    const createMessageInternal = jest.spyOn(ctx.service, 'createMessageInternal').mockResolvedValue(created);

    const dto = { author: 'Alice', message: 'hi' } as CreateSupportMessageDto;
    const result = await ctx.service.createMessageSupport(7, dto);

    expect(ctx.supportIssueRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    expect(createMessageInternal).toHaveBeenCalledWith(issue, dto);
    expect(result).toBe(created);
  });
});

describe('SupportIssueService.getIssueEntities', () => {
  it('finds issues for the userData id, newest first, without eager relations', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.find.mockResolvedValue([]);

    await ctx.service.getIssueEntities(42);

    expect(ctx.supportIssueRepo.find).toHaveBeenCalledWith({
      where: { userData: { id: 42 } },
      relations: { transaction: true, limitRequest: true, messages: true },
      loadEagerRelations: false,
      order: { created: 'DESC' },
    });
  });
});

describe('SupportIssueService.getIssues', () => {
  it('maps the found issues via SupportIssueDtoMapper', async () => {
    const ctx = buildService();
    const issue = Object.assign(new SupportIssue(), {
      id: 1,
      uid: 'I1',
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      state: SupportIssueInternalState.PENDING,
      name: 'Help',
      created: new Date('2026-01-01T00:00:00.000Z'),
    });
    ctx.supportIssueRepo.find.mockResolvedValue([issue]);

    const result = await ctx.service.getIssues(42);

    expect(ctx.supportIssueRepo.find).toHaveBeenCalledWith({
      where: { userData: { id: 42 } },
      relations: { transaction: true, limitRequest: true },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ uid: 'I1', name: 'Help' });
  });
});

describe('SupportIssueService.getIssue', () => {
  beforeEach(() => {
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { issueUidPrefix: 'I', quoteUidPrefix: 'Q' },
    };
  });

  const makeIssue = (): SupportIssue =>
    Object.assign(new SupportIssue(), {
      id: 7,
      uid: 'I123',
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      name: 'Help',
      created: new Date('2026-01-01T00:00:00.000Z'),
    });

  it('throws NotFound when the issue does not exist', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(ctx.service.getIssue('I123', {} as GetSupportIssueFilter)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loads only messages newer than fromMessageId and maps the issue', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(makeIssue());
    ctx.messageRepo.findBy.mockResolvedValue([]);

    await ctx.service.getIssue('I123', { fromMessageId: 10 } as GetSupportIssueFilter, 42);

    const findByArg = ctx.messageRepo.findBy.mock.calls[0][0] as { issue: { id: number }; id: { value: number } };
    expect(findByArg.issue).toEqual({ id: 7 });
    expect(findByArg.id.value).toBe(10);
  });

  it('defaults fromMessageId to 0 when the filter omits it', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(makeIssue());
    ctx.messageRepo.findBy.mockResolvedValue([]);

    await ctx.service.getIssue('I123', {} as GetSupportIssueFilter, 42);

    const findByArg = ctx.messageRepo.findBy.mock.calls[0][0] as { id: { value: number } };
    expect(findByArg.id.value).toBe(0);
  });
});

describe('SupportIssueService.getIssueData', () => {
  const makeIssue = (overrides: Partial<SupportIssue> = {}): SupportIssue =>
    Object.assign(new SupportIssue(), {
      id: 5,
      type: SupportIssueType.GENERIC_ISSUE,
      userData: { id: 42, annualBuyVolume: 0, annualSellVolume: 0, annualCryptoVolume: 0 } as UserData,
      limitRequest: { id: 9, limit: 1000 } as any,
      ...overrides,
    });

  it('throws NotFound when the issue does not exist', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(ctx.service.getIssueData(1, UserRole.ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed (NotFound) when the customerIds scope excludes the issue owner, without an existence leak', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(makeIssue({ userData: { id: 99 } as UserData }));
    await expect(ctx.service.getIssueData(5, UserRole.REALUNIT, [42])).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([UserRole.SUPPORT, UserRole.REALUNIT])(
    'hides the DFX AML-internal limit request for %s staff',
    async (role) => {
      const ctx = buildService();
      ctx.supportIssueRepo.findOne.mockResolvedValue(makeIssue());
      const dto = await ctx.service.getIssueData(5, role);
      expect(dto.limitRequest).toBeUndefined();
    },
  );

  it('shows the limit request for Compliance/Admin staff', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(makeIssue());
    const dto = await ctx.service.getIssueData(5, UserRole.COMPLIANCE);
    expect(dto.limitRequest).toEqual({ id: 9, limit: 1000 });
  });
});

describe('SupportIssueService.getIssueFile', () => {
  beforeEach(() => {
    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { issueUidPrefix: 'I', quoteUidPrefix: 'Q' },
    };
  });

  it('throws NotFound when the message does not exist', async () => {
    const ctx = buildService();
    ctx.messageRepo.findOneBy.mockResolvedValue(null);
    await expect(ctx.service.getIssueFile('I123', 5, 42)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('downloads the file scoped by message owner, issue id, and decoded file name', async () => {
    const ctx = buildService();
    const message = Object.assign(new SupportMessage(), {
      id: 5,
      fileUrl: 'https://blob/user/42/Issue/7/scan.png',
      issue: Object.assign(new SupportIssue(), { id: 7, userData: { id: 42 } as UserData }),
    });
    ctx.messageRepo.findOneBy.mockResolvedValue(message);
    const blob = { contentType: 'image/png', buffer: Buffer.from('x') } as unknown as BlobContent;
    ctx.documentService.downloadFile.mockResolvedValue(blob);

    const result = await ctx.service.getIssueFile('I123', 5, 42);

    expect(ctx.messageRepo.findOneBy).toHaveBeenCalledWith({ id: 5, issue: { uid: 'I123' } });
    expect(ctx.documentService.downloadFile).toHaveBeenCalledWith(42, 7, 'scan.png');
    expect(result).toBe(blob);
  });
});

describe('SupportIssueService.getUserIssues', () => {
  it('returns the userData issues together with the full message set for those issues', async () => {
    const ctx = buildService();
    const issues = [Object.assign(new SupportIssue(), { id: 1 }), Object.assign(new SupportIssue(), { id: 2 })];
    ctx.supportIssueRepo.find.mockResolvedValue(issues);
    const messages = [Object.assign(new SupportMessage(), { id: 10 })];
    ctx.messageRepo.findBy.mockResolvedValue(messages);

    const result = await ctx.service.getUserIssues(42);

    expect(ctx.supportIssueRepo.find).toHaveBeenCalledWith({
      where: { userData: { id: 42 } },
      relations: { transaction: true, limitRequest: true },
    });
    const findByArg = ctx.messageRepo.findBy.mock.calls[0][0] as unknown as { issue: { id: { value: number[] } } };
    expect(findByArg.issue.id.value).toEqual([1, 2]);
    expect(result).toEqual({ supportIssues: issues, supportMessages: messages });
  });
});

describe('SupportIssueService.getIssueUserDataId', () => {
  it('throws NotFound when the issue does not exist', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(null);
    await expect(ctx.service.getIssueUserDataId(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when the issue has no owning userData', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(Object.assign(new SupportIssue(), { id: 1, userData: undefined }));
    await expect(ctx.service.getIssueUserDataId(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves the owning userData id', async () => {
    const ctx = buildService();
    ctx.supportIssueRepo.findOne.mockResolvedValue(
      Object.assign(new SupportIssue(), { id: 1, userData: { id: 77 } as UserData }),
    );
    await expect(ctx.service.getIssueUserDataId(1)).resolves.toBe(77);
  });
});

describe('SupportIssueService.createMessageInternal', () => {
  let ctx: ReturnType<typeof buildService>;

  const makeIssue = (overrides: Partial<SupportIssue> = {}): SupportIssue =>
    Object.assign(new SupportIssue(), {
      id: 7,
      state: SupportIssueInternalState.PENDING,
      clerk: undefined,
      userData: { id: 42 } as UserData,
      ...overrides,
    });

  beforeEach(() => {
    ctx = buildService();
    // Mirrors TypeORM's real `Repository.create()`, which copies only known @Column/relation fields from
    // the plain object (author, message, issue) - NOT the DTO-only `file`/`fileName` fields, which would
    // collide with SupportMessage's getter-only `fileName` accessor under a naive Object.assign.
    ctx.messageRepo.create.mockImplementation((obj: { author?: string; message?: string; issue?: SupportIssue }) =>
      Object.assign(new SupportMessage(), { author: obj.author, message: obj.message, issue: obj.issue }),
    );
  });

  it('throws BadRequest when the author is missing', async () => {
    await expect(
      ctx.service.createMessageInternal(makeIssue(), { message: 'hi' } as CreateSupportMessageDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when neither message nor file is provided', async () => {
    await expect(
      ctx.service.createMessageInternal(makeIssue(), { author: 'Alice' } as CreateSupportMessageDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when the message exceeds 4000 characters', async () => {
    const dto = { author: 'Alice', message: 'x'.repeat(4001) } as CreateSupportMessageDto;
    await expect(ctx.service.createMessageInternal(makeIssue(), dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploads a base64 file, naming it with the timestamp, author, a random id, and the original file name', async () => {
    ctx.documentService.uploadUserFile.mockResolvedValue('https://blob/url');
    const dto = {
      author: 'Alice',
      file: 'data:image/png;base64,aGVsbG8=',
      fileName: 'scan.png',
    } as CreateSupportMessageDto;

    await ctx.service.createMessageInternal(makeIssue(), dto);

    expect(ctx.documentService.uploadUserFile).toHaveBeenCalledWith(
      42,
      7,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_alice_\d+_scan\.png$/),
      Buffer.from('aGVsbG8=', 'base64'),
      'image/png',
    );
    expect(ctx.messageRepo.save).toHaveBeenCalledWith(expect.objectContaining({ fileUrl: 'https://blob/url' }));
  });

  it('skips the upload when dto.file is absent', async () => {
    const dto = { author: 'Alice', message: 'hi' } as CreateSupportMessageDto;
    await ctx.service.createMessageInternal(makeIssue(), dto);
    expect(ctx.documentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('sets the clerk and notifies when the author is not the customer', async () => {
    const issue = makeIssue({ clerk: undefined });
    const dto = { author: 'Alice', message: 'hi' } as CreateSupportMessageDto;

    await ctx.service.createMessageInternal(issue, dto);

    expect(ctx.supportIssueRepo.update).toHaveBeenCalledWith(7, { clerk: 'Alice' });
    expect(ctx.supportIssueNotificationService.newSupportMessage).toHaveBeenCalledWith(
      expect.objectContaining({ author: 'Alice', message: 'hi' }),
    );
  });

  it('clears an AutoResponder clerk when the customer replies', async () => {
    const issue = makeIssue({ clerk: AutoResponder });
    const dto = { author: CustomerAuthor, message: 'thanks' } as CreateSupportMessageDto;

    await ctx.service.createMessageInternal(issue, dto);

    expect(ctx.supportIssueRepo.update).toHaveBeenCalledWith(7, { clerk: null });
    expect(ctx.supportIssueNotificationService.newSupportMessage).not.toHaveBeenCalled();
  });

  it('leaves the clerk untouched (no update, no notification) for a customer reply on a non-autoresponder issue', async () => {
    const issue = makeIssue({ clerk: 'Alice' });
    const dto = { author: CustomerAuthor, message: 'thanks' } as CreateSupportMessageDto;

    await ctx.service.createMessageInternal(issue, dto);

    expect(ctx.supportIssueRepo.update).not.toHaveBeenCalled();
    expect(ctx.supportIssueNotificationService.newSupportMessage).not.toHaveBeenCalled();
  });

  it.each([SupportIssueInternalState.COMPLETED, SupportIssueInternalState.ON_HOLD, SupportIssueInternalState.CANCELED])(
    'reopens a %s issue to Pending on a new message',
    async (state) => {
      const issue = makeIssue({ state, clerk: 'Alice' });
      const dto = { author: CustomerAuthor, message: 'reopening' } as CreateSupportMessageDto;

      await ctx.service.createMessageInternal(issue, dto);

      expect(ctx.supportIssueRepo.update).toHaveBeenCalledWith(7, { state: SupportIssueInternalState.PENDING });
    },
  );

  it.each([
    SupportIssueInternalState.PENDING,
    SupportIssueInternalState.IN_PROGRESS,
    SupportIssueInternalState.IN_CLARIFICATION,
    SupportIssueInternalState.CREATED,
  ])('does not reopen a %s issue', async (state) => {
    const issue = makeIssue({ state, clerk: 'Alice' });
    const dto = { author: CustomerAuthor, message: 'still going' } as CreateSupportMessageDto;

    await ctx.service.createMessageInternal(issue, dto);

    expect(ctx.supportIssueRepo.update).not.toHaveBeenCalled();
  });

  it('returns the mapped message dto', async () => {
    const dto = { author: 'Alice', message: 'hi there' } as CreateSupportMessageDto;
    const result = await ctx.service.createMessageInternal(makeIssue(), dto);
    expect(result).toMatchObject({ author: 'Alice', message: 'hi there' });
  });
});
