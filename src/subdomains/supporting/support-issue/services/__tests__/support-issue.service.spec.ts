import { NotFoundException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ConfigModule from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import {
  GetSupportIssueListFilter,
  ListOrderDirection,
  SupportIssueListOrderBy,
} from 'src/subdomains/supporting/support-issue/dto/get-support-issue.dto';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
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

  let trendRows: { d: Date; count: string }[];
  let resolvedRows: { type: SupportIssueType; created: Date; updated: Date }[];
  let totalCount: number;
  let andWhereClauses: string[];

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
    qb.getRawOne = jest.fn(() => Promise.resolve({ count: String(totalCount) }));
    qb.getRawMany = jest.fn(() => Promise.resolve(grouped ? trendRows : resolvedRows));
    return qb;
  }

  beforeEach(() => {
    trendRows = [];
    resolvedRows = [];
    totalCount = 0;
    andWhereClauses = [];
    const supportIssueRepo = createMock<SupportIssueRepository>();
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
});
