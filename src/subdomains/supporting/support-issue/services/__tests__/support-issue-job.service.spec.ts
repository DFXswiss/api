import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { MailFactory } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { SupportIssueRepository } from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SupportIssueJobService } from 'src/subdomains/supporting/support-issue/services/support-issue-job.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';

// The auto-responder decides whether to mail a customer by reading `messages.at(-1)`, i.e. it
// indexes into the loaded array positionally. Without an explicit order Postgres may return the
// thread in any order, so the bot would answer tickets support already replied to and skip the ones
// actually waiting. The sibling job (autoOnHold) has always ordered; this pins the other call site.
describe('SupportIssueJobService auto-response selection', () => {
  let service: SupportIssueJobService;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;

  beforeEach(() => {
    supportIssueRepo = createMock<SupportIssueRepository>();
    supportIssueRepo.find.mockResolvedValue([]);

    service = new SupportIssueJobService(
      supportIssueRepo,
      createMock<SupportIssueService>(),
      createMock<MailFactory>(),
      createMock<SettingService>(),
    );
  });

  it('loads the thread in chronological order before reading the last message', async () => {
    await service.moneroComplete();

    expect(supportIssueRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: { messages: true },
        order: { messages: { created: 'ASC', id: 'ASC' } },
      }),
    );
  });

  // relations: { messages: true } is a LEFT JOIN, so an issue whose first message never got written
  // comes back with an empty array. Without a length guard at(-1) throws, the cron lock swallows it,
  // and the whole auto-response run aborts - every minute, until someone fixes the row by hand.
  it('ignores an issue that has no messages instead of throwing', async () => {
    supportIssueRepo.find.mockResolvedValue([{ id: 1, messages: [] }] as never);

    await expect(service.moneroComplete()).resolves.not.toThrow();
  });

  it('orders the thread for the on-hold sweep as well', async () => {
    await service.autoOnHold();

    for (const call of supportIssueRepo.find.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ order: { messages: { created: 'ASC', id: 'ASC' } } }));
    }
    expect(supportIssueRepo.find).toHaveBeenCalled();
  });
});
