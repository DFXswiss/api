import { createMock } from '@golevelup/ts-jest';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpService } from 'src/shared/services/http.service';
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
