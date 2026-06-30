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

  beforeEach(() => {
    qb = createQbMock();
    const supportIssueRepo = createMock<SupportIssueRepository>();
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
      expect(errors.some((e) => e.property === 'orderBy')).toBe(true);
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
