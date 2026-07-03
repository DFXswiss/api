import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { createCustomWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MailRequest } from '../../../notification/interfaces';
import { NotificationService } from '../../../notification/services/notification.service';
import { SupportIssue } from '../../entities/support-issue.entity';
import { SupportMessage } from '../../entities/support-message.entity';
import { SupportIssueNotificationService } from '../support-issue-notification.service';

describe('SupportIssueNotificationService', () => {
  let service: SupportIssueNotificationService;

  let notificationService: NotificationService;

  const dfxWallet = createCustomWallet({ name: 'DFX' });
  const realUnitWallet = createCustomWallet({ name: 'RealUnit' });

  beforeEach(async () => {
    notificationService = createMock<NotificationService>();

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SupportIssueNotificationService,
        { provide: NotificationService, useValue: notificationService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SupportIssueNotificationService>(SupportIssueNotificationService);
  });

  afterEach(() => {
    delete Config.mail.wallet.RealUnit;
  });

  function createSupportMessage(userData: UserData, issueWallet?: Wallet): SupportMessage {
    const issue = Object.assign(new SupportIssue(), { id: 1, uid: 'I-1', userData, wallet: issueWallet });
    return Object.assign(new SupportMessage(), { id: 1, author: 'Support', issue });
  }

  async function sendForWallet(issueWallet?: Wallet): Promise<jest.SpyInstance> {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
    const userData = createCustomUserData({ id: 7, mail: 'user@test.com' });
    await service.newSupportMessage(createSupportMessage(userData, issueWallet));
    return sendMail;
  }

  async function sentMailInput(issueWallet?: Wallet): Promise<MailRequest['input']> {
    const sendMail = await sendForWallet(issueWallet);
    expect(sendMail).toHaveBeenCalledTimes(1);
    return sendMail.mock.calls[0][0].input;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('brands the mail RealUnit when the ticket was opened from the RealUnit app', async () => {
    Config.mail.wallet.RealUnit = { template: 'realunit' };

    const input = await sentMailInput(realUnitWallet);

    expect('wallet' in input && (input.wallet as Wallet)?.name).toBe('RealUnit');
  });

  it('brands the mail DFX when the ticket was exactly DFX-attributed', async () => {
    const input = await sentMailInput(dfxWallet);

    expect('wallet' in input && (input.wallet as Wallet)?.name).toBe('DFX');
  });

  it('fails closed (no mail, error log) when the issue carries no attributed source', async () => {
    const error = jest.spyOn(service['logger'], 'error');

    const sendMail = await sendForWallet(undefined);

    expect(sendMail).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no attributed source'));
  });

  it('fails closed instead of mis-branding when RealUnit is attributed but REALUNIT_MAIL_USER is unset', async () => {
    const error = jest.spyOn(service['logger'], 'error');

    // test config has no REALUNIT_MAIL_USER -> Config.mail.wallet.RealUnit is absent
    const sendMail = await sendForWallet(realUnitWallet);

    expect(sendMail).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('REALUNIT_MAIL_USER is unset'));
  });

  it('does not send a mail when the user has no mail address', async () => {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service.newSupportMessage(createSupportMessage(createCustomUserData({ id: 7, mail: undefined }), dfxWallet));

    expect(sendMail).not.toHaveBeenCalled();
  });
});
