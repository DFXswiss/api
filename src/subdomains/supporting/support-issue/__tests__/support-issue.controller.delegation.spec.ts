import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ModuleRef } from '@nestjs/core';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSupportIssueDto, CreateSupportIssueSupportDto } from '../dto/create-support-issue.dto';
import { GetSupportIssueFilter, GetSupportIssueListFilter } from '../dto/get-support-issue.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { CustomerAuthor } from '../entities/support-message.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportEscalationService, TelegramChat } from '../services/support-escalation.service';
import { SupportIssueService } from '../services/support-issue.service';
import { SupportReplySuggestionService } from '../services/support-reply-suggestion.service';
import { SupportIssueController } from '../support-issue.controller';

// Same reason as in support-issue.controller.spec.ts: the controller imports TfaService from the kyc
// domain, whose entity graph resolves to `undefined` when a spec loads it in isolation.
jest.mock('src/subdomains/generic/kyc/services/tfa.service', () => ({
  TfaLevel: { BASIC: 'Basic', STRICT: 'Strict' },
  TfaService: class TfaService {},
}));

// The controller is thin by contract: every handler does routing and delegation and nothing else.
// These tests pin exactly that — which service call a route reaches, and with which arguments.
describe('SupportIssueController delegation', () => {
  let controller: SupportIssueController;
  let service: DeepMocked<SupportIssueService>;
  let escalationService: DeepMocked<SupportEscalationService>;
  let suggestionService: DeepMocked<SupportReplySuggestionService>;

  const jwt = (values: Partial<JwtPayload> = {}): JwtPayload =>
    ({ account: 7, role: UserRole.SUPPORT, ...values }) as JwtPayload;

  beforeEach(() => {
    service = createMock<SupportIssueService>();
    escalationService = createMock<SupportEscalationService>();
    suggestionService = createMock<SupportReplySuggestionService>();

    controller = new SupportIssueController(service, escalationService, suggestionService, createMock<ModuleRef>());
  });

  describe('createIssue', () => {
    const dto = (values: Partial<CreateSupportIssueDto> = {}): CreateSupportIssueDto =>
      ({
        type: SupportIssueType.GENERIC_ISSUE,
        reason: SupportIssueReason.OTHER,
        name: 'Max',
        ...values,
      }) as CreateSupportIssueDto;

    it('routes an authenticated request to the account issue', async () => {
      await controller.createIssue(jwt(), dto(), 'dfx-services');

      expect(service.createIssue).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ author: CustomerAuthor, department: Department.SUPPORT }),
        'dfx-services',
      );
      expect(service.createTransactionRequestIssue).not.toHaveBeenCalled();
    });

    it('routes an anonymous request to the transaction request issue', async () => {
      await controller.createIssue(undefined, dto(), undefined);

      expect(service.createTransactionRequestIssue).toHaveBeenCalledWith(
        expect.objectContaining({ author: CustomerAuthor }),
        undefined,
      );
      expect(service.createIssue).not.toHaveBeenCalled();
    });

    it.each([
      [dto({ type: SupportIssueType.VERIFICATION_CALL }), Department.COMPLIANCE],
      [dto({ limitRequest: { limit: 1000 } } as Partial<CreateSupportIssueDto>), Department.COMPLIANCE],
      [dto(), Department.SUPPORT],
    ])('assigns the department that handles the issue', async (input, expected) => {
      await controller.createIssue(jwt(), input, undefined);

      expect(service.createIssue).toHaveBeenCalledWith(7, expect.objectContaining({ department: expected }), undefined);
    });
  });

  describe('createIssueBySupport', () => {
    const dto = {} as CreateSupportIssueSupportDto;

    it.each([
      [UserRole.COMPLIANCE, Department.COMPLIANCE],
      [UserRole.SUPPORT, Department.SUPPORT],
    ])('files a %s-created issue under %s', async (role, expected) => {
      await controller.createIssueBySupport('11', dto, jwt({ role }));

      expect(service.createIssueBySupport).toHaveBeenCalledWith(11, expect.objectContaining({ department: expected }));
    });
  });

  it('getIssues delegates with the account', async () => {
    await controller.getIssues(jwt());

    expect(service.getIssues).toHaveBeenCalledWith(7);
  });

  it('getSupportIssueList passes filter and role', async () => {
    const filter = {} as GetSupportIssueListFilter;

    await controller.getSupportIssueList(jwt(), filter);

    expect(service.getSupportIssueList).toHaveBeenCalledWith(filter, UserRole.SUPPORT);
  });

  it('getSupportIssueCounts passes the role', async () => {
    await controller.getSupportIssueCounts(jwt());

    expect(service.getSupportIssueCounts).toHaveBeenCalledWith(UserRole.SUPPORT);
  });

  describe('getSupportIssueStatistics', () => {
    it('passes the requested period', async () => {
      await controller.getSupportIssueStatistics(jwt(), '30');

      expect(service.getSupportIssueStatistics).toHaveBeenCalledWith(UserRole.SUPPORT, 30);
    });

    it('leaves the period to the service when none is given', async () => {
      await controller.getSupportIssueStatistics(jwt(), undefined);

      expect(service.getSupportIssueStatistics).toHaveBeenCalledWith(UserRole.SUPPORT, undefined);
    });
  });

  describe('getSupportIssueActivity', () => {
    it('passes the parsed timestamp', async () => {
      await controller.getSupportIssueActivity(jwt(), '2026-08-08T10:00:00.000Z');

      expect(service.getSupportIssueActivity).toHaveBeenCalledWith(
        new Date('2026-08-08T10:00:00.000Z'),
        UserRole.SUPPORT,
      );
    });

    it('asks for the full activity when no timestamp is given', async () => {
      await controller.getSupportIssueActivity(jwt(), undefined);

      expect(service.getSupportIssueActivity).toHaveBeenCalledWith(undefined, UserRole.SUPPORT);
    });
  });

  it('getSupportIssueClerks delegates', async () => {
    service.getSupportIssueClerks.mockResolvedValue(['Alex']);

    await expect(controller.getSupportIssueClerks()).resolves.toEqual(['Alex']);
  });

  describe('getSupportIssueClerk', () => {
    it('returns the clerk mapped to the account', async () => {
      service.getSupportIssueClerkForAccount.mockResolvedValue('Alex');

      await expect(controller.getSupportIssueClerk(jwt())).resolves.toEqual({ clerk: 'Alex' });
    });

    it('answers with null for an unmapped account', async () => {
      service.getSupportIssueClerkForAccount.mockResolvedValue(undefined);

      await expect(controller.getSupportIssueClerk(jwt())).resolves.toEqual({ clerk: null });
    });
  });

  describe('escalation chats', () => {
    it('lists the group chats', async () => {
      const chats = [{ id: 1, title: 'Support' }] as TelegramChat[];
      escalationService.getGroupChats.mockResolvedValue(chats);

      await expect(controller.getEscalationChats()).resolves.toEqual(chats);
    });

    it('returns the bound chat', async () => {
      const chat = { id: 1, title: 'Support' } as TelegramChat;
      escalationService.bindGroupChat.mockResolvedValue(chat);

      await expect(controller.bindEscalationChat({ chatId: 1 })).resolves.toEqual({ chat });
    });

    it('answers with null when no chat could be bound', async () => {
      escalationService.bindGroupChat.mockResolvedValue(undefined);

      await expect(controller.bindEscalationChat({ chatId: 1 })).resolves.toEqual({ chat: null });
    });

    it('reports whether the test message was sent', async () => {
      escalationService.sendTestMessage.mockResolvedValue(true);

      await expect(controller.testEscalationChat()).resolves.toEqual({ sent: true });
    });
  });

  it('getIssue passes id, query and account', async () => {
    const query = {} as GetSupportIssueFilter;

    await controller.getIssue(jwt(), 'issue-uid', query);

    expect(service.getIssue).toHaveBeenCalledWith('issue-uid', query, 7);
  });

  it('getIssue works without a session', async () => {
    const query = {} as GetSupportIssueFilter;

    await controller.getIssue(undefined, 'issue-uid', query);

    expect(service.getIssue).toHaveBeenCalledWith('issue-uid', query, undefined);
  });

  it('getIssueData passes the role', async () => {
    await controller.getIssueData(jwt(), '42');

    expect(service.getIssueData).toHaveBeenCalledWith(42, UserRole.SUPPORT);
  });

  it('getFile passes issue and message', async () => {
    await controller.getFile(jwt(), 'issue-uid', 3);

    expect(service.getIssueFile).toHaveBeenCalledWith('issue-uid', 3, 7);
  });

  it('getFile works without a session', async () => {
    await controller.getFile(undefined, 'issue-uid', 3);

    expect(service.getIssueFile).toHaveBeenCalledWith('issue-uid', 3, undefined);
  });

  it('closeIssue passes the account', async () => {
    await controller.closeIssue(jwt(), 'issue-uid');

    expect(service.closeIssue).toHaveBeenCalledWith('issue-uid', 7);
  });

  it('closeIssue works without a session', async () => {
    await controller.closeIssue(undefined, 'issue-uid');

    expect(service.closeIssue).toHaveBeenCalledWith('issue-uid', undefined);
  });

  it('updateSupportIssue delegates', async () => {
    const dto = {} as UpdateSupportIssueDto;

    await controller.updateSupportIssue('42', dto);

    expect(service.updateIssue).toHaveBeenCalledWith(42, dto);
  });

  describe('reply suggestions', () => {
    it('submits a suggestion for the calling account', async () => {
      await controller.createReplySuggestion(jwt(), '42', { text: 'Answer' });

      expect(suggestionService.createSuggestion).toHaveBeenCalledWith(42, { text: 'Answer' }, 7);
    });

    it('returns the pending suggestion', async () => {
      const suggestion = { id: 3 } as Awaited<ReturnType<SupportReplySuggestionService['getPendingSuggestion']>>;
      suggestionService.getPendingSuggestion.mockResolvedValue(suggestion);

      await expect(controller.getReplySuggestion('42')).resolves.toEqual({ suggestion });
      expect(suggestionService.getPendingSuggestion).toHaveBeenCalledWith(42);
    });

    it('answers with null when no suggestion awaits a decision', async () => {
      suggestionService.getPendingSuggestion.mockResolvedValue(undefined);

      await expect(controller.getReplySuggestion('42')).resolves.toEqual({ suggestion: null });
    });

    it('accepts a suggestion for the deciding clerk', async () => {
      await controller.acceptReplySuggestion(jwt(), '42', 3);

      expect(suggestionService.acceptSuggestion).toHaveBeenCalledWith(42, 3, 7);
    });

    it('rejects a suggestion for the deciding clerk', async () => {
      await controller.rejectReplySuggestion(jwt(), '42', 3);

      expect(suggestionService.rejectSuggestion).toHaveBeenCalledWith(42, 3, 7);
    });
  });
});
