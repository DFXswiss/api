import { createMock } from '@golevelup/ts-jest';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import {
  GetSupportIssueListFilter,
  ListOrderDirection,
  SupportIssueListOrderBy,
} from 'src/subdomains/supporting/support-issue/dto/get-support-issue.dto';
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

    it('does not add date clauses when absent', async () => {
      await run({});
      expect(andWhereClauses().some((c) => c.includes('issue.created'))).toBe(false);
    });
  });

  describe('sorting', () => {
    it('defaults to created DESC without an id tie-break', async () => {
      await run({});
      expect(qb.orderBy).toHaveBeenCalledWith('issue.created', 'DESC');
      expect(qb.addOrderBy).not.toHaveBeenCalled();
    });

    it('applies a whitelisted sort column with an id tie-break for stable pagination', async () => {
      await run({ orderBy: SupportIssueListOrderBy.CLERK, orderDir: ListOrderDirection.ASC });
      expect(qb.orderBy).toHaveBeenCalledWith('issue.clerk', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('issue.id', 'ASC');
    });

    it('only ever sorts on whitelisted enum columns (no raw injection surface)', async () => {
      await run({ orderBy: SupportIssueListOrderBy.UPDATED, orderDir: ListOrderDirection.DESC });
      const sortedColumn = qb.orderBy.mock.calls[0][0] as string;
      const allowed = Object.values(SupportIssueListOrderBy).map((c) => `issue.${c}`);
      expect(allowed).toContain(sortedColumn);
    });
  });
});
