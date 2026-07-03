import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as ConfigModule from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpService } from 'src/shared/services/http.service';
import { SupportIssue } from '../../entities/support-issue.entity';
import { CustomerAuthor } from '../../entities/support-message.entity';
import { SupportIssueReason, SupportIssueType } from '../../enums/support-issue.enum';
import { SupportMessageRepository } from '../../repositories/support-message.repository';
import { SupportIssueRepository } from '../../repositories/support-issue.repository';
import { SupportEscalationService } from '../support-escalation.service';

// Guards the escalation-chat binding: it must never pick an arbitrary group, because escalation
// messages carry customer PII. Auto-bind only on a single explicit invite; otherwise stay unbound.
describe('SupportEscalationService.bindGroupChat', () => {
  let service: SupportEscalationService;
  let http: HttpService;
  let settingService: SettingService;

  const joined = (id: number, title: string) => ({
    my_chat_member: { chat: { id, type: 'group', title }, new_chat_member: { status: 'member' } },
  });
  const seen = (id: number, title: string) => ({ message: { chat: { id, type: 'group', title } } });

  const mockUpdates = (updates: unknown[]) => jest.spyOn(http, 'get').mockResolvedValue({ result: updates } as never);

  beforeEach(() => {
    http = createMock<HttpService>();
    settingService = createMock<SettingService>();
    service = new SupportEscalationService(
      http,
      settingService,
      createMock<SupportIssueRepository>(),
      createMock<SupportMessageRepository>(),
    );
    // a bot token must be present for the Telegram calls to run
    jest.spyOn(service as unknown as { token: string }, 'token', 'get').mockReturnValue('test-token');
  });

  it('auto-binds the single group that explicitly invited the bot', async () => {
    mockUpdates([joined(111, 'Support')]);

    const result = await service.bindGroupChat();

    expect(result).toEqual({ id: 111, title: 'Support' });
    expect(settingService.set).toHaveBeenCalledWith('supportEscalationChatId', '111');
  });

  it('does not auto-bind when several groups invited the bot (no arbitrary pick)', async () => {
    mockUpdates([joined(111, 'Support'), joined(222, 'Random')]);

    const result = await service.bindGroupChat();

    expect(result).toBeUndefined();
    expect(settingService.set).not.toHaveBeenCalled();
  });

  it('does not auto-bind a merely-seen group that never invited the bot', async () => {
    mockUpdates([seen(333, 'Lurking')]);

    const result = await service.bindGroupChat();

    expect(result).toBeUndefined();
    expect(settingService.set).not.toHaveBeenCalled();
  });

  it('binds an explicit chatId that the bot can see', async () => {
    mockUpdates([seen(333, 'Chosen'), seen(444, 'Other')]);

    const result = await service.bindGroupChat(333);

    expect(result).toEqual({ id: 333, title: 'Chosen' });
    expect(settingService.set).toHaveBeenCalledWith('supportEscalationChatId', '333');
  });

  it('refuses an explicit chatId the bot cannot see', async () => {
    mockUpdates([seen(333, 'Chosen')]);

    const result = await service.bindGroupChat(999);

    expect(result).toBeUndefined();
    expect(settingService.set).not.toHaveBeenCalled();
  });
});

// Guards the escalation detection: a ticket escalates once the customer wrote last and has waited past the
// SLA, and is then de-duplicated per waiting cycle so the group is not spammed every cron run.
describe('SupportEscalationService.checkEscalations', () => {
  let service: SupportEscalationService;
  let settingService: DeepMocked<SettingService>;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let messageRepo: DeepMocked<SupportMessageRepository>;

  const NOTIFIED_KEY = 'supportEscalationNotified';
  const ISSUE_ID = 7;
  // a customer message that has been waiting well beyond the 24h SLA
  const waitedSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const cycle = waitedSince.toISOString();

  function makeIssue(): SupportIssue {
    return Object.assign(new SupportIssue(), {
      id: ISSUE_ID,
      type: SupportIssueType.GENERIC_ISSUE,
      reason: SupportIssueReason.OTHER,
      name: 'Jane',
    });
  }

  // getLastMessages reads the latest message per issue via a query builder; stub it to a single row
  const mockLastMessage = (author: string, date: Date): void => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['select', 'addSelect', 'where', 'groupBy']) qb[m] = jest.fn(() => qb);
    qb.getRawMany = jest.fn().mockResolvedValue([{ issueId: String(ISSUE_ID), lastDate: date, lastAuthor: author }]);
    (messageRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
  };

  beforeEach(() => {
    // token + slaHours are read from Config, which is only populated at bootstrap — stub it here
    (ConfigModule as Record<string, unknown>).Config = {
      support: { escalation: { telegramBotToken: 'test-token', slaHours: 24 } },
      frontend: { services: '' },
    };

    settingService = createMock<SettingService>();
    supportIssueRepo = createMock<SupportIssueRepository>();
    messageRepo = createMock<SupportMessageRepository>();
    service = new SupportEscalationService(createMock<HttpService>(), settingService, supportIssueRepo, messageRepo);

    settingService.get.mockResolvedValue('555'); // escalation chat already bound
    supportIssueRepo.find.mockResolvedValue([makeIssue()]);
    mockLastMessage(CustomerAuthor, waitedSince); // by default the customer wrote last, overdue
  });

  it('escalates an overdue customer-waiting ticket once and records the waiting cycle', async () => {
    settingService.getObj.mockImplementation((key: string) => Promise.resolve(key === NOTIFIED_KEY ? {} : []));
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue();

    await service.checkEscalations();

    expect(send).toHaveBeenCalledTimes(1);
    expect(settingService.setObj).toHaveBeenCalledWith(NOTIFIED_KEY, { [ISSUE_ID]: cycle });
  });

  it('does not re-escalate the same waiting cycle (de-dup), but keeps the marker', async () => {
    settingService.getObj.mockImplementation((key: string) =>
      Promise.resolve(key === NOTIFIED_KEY ? { [ISSUE_ID]: cycle } : []),
    );
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue();

    await service.checkEscalations();

    expect(send).not.toHaveBeenCalled();
    expect(settingService.setObj).toHaveBeenCalledWith(NOTIFIED_KEY, { [ISSUE_ID]: cycle });
  });

  it('does not escalate when support — not the customer — wrote the last message', async () => {
    mockLastMessage('Support', waitedSince);
    settingService.getObj.mockImplementation((key: string) => Promise.resolve(key === NOTIFIED_KEY ? {} : []));
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue();

    await service.checkEscalations();

    expect(send).not.toHaveBeenCalled();
    expect(settingService.setObj).toHaveBeenCalledWith(NOTIFIED_KEY, {}); // nothing marked for this cycle
  });

  it('does nothing when no escalation chat is bound (the cron never auto-binds)', async () => {
    settingService.get.mockResolvedValue(undefined);
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue();

    await service.checkEscalations();

    expect(supportIssueRepo.find).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

// The Telegram client self-heals the binding: it rebinds on a supergroup migration and drops a dead binding.
describe('SupportEscalationService.sendMessage', () => {
  let service: SupportEscalationService;
  let http: DeepMocked<HttpService>;
  let settingService: DeepMocked<SettingService>;

  const CHAT_ID_KEY = 'supportEscalationChatId';
  const telegramError = (data: object): Error => Object.assign(new Error('Request failed'), { response: { data } });

  beforeEach(() => {
    (ConfigModule as Record<string, unknown>).Config = { support: { escalation: { telegramBotToken: 'test-token' } } };
    http = createMock<HttpService>();
    settingService = createMock<SettingService>();
    service = new SupportEscalationService(
      http,
      settingService,
      createMock<SupportIssueRepository>(),
      createMock<SupportMessageRepository>(),
    );
  });

  it('rebinds to the new chat id and resends when the group migrated to a supergroup', async () => {
    (http.post as jest.Mock)
      .mockRejectedValueOnce(
        telegramError({
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: -100123 },
        }),
      )
      .mockResolvedValueOnce(undefined);

    await service.sendMessage('555', 'hi');

    expect(settingService.set).toHaveBeenCalledWith(CHAT_ID_KEY, '-100123');
    expect(http.post).toHaveBeenCalledTimes(2);
    expect((http.post.mock.calls[1][1] as { chat_id: string }).chat_id).toBe('-100123');
  });

  it('clears the binding and rethrows when the bound chat is unreachable', async () => {
    const err = telegramError({ description: 'Forbidden: bot was kicked from the group chat' });
    (http.post as jest.Mock).mockRejectedValue(err);

    await expect(service.sendMessage('555', 'hi')).rejects.toBe(err);
    expect(settingService.set).toHaveBeenCalledWith(CHAT_ID_KEY, '');
  });
});
