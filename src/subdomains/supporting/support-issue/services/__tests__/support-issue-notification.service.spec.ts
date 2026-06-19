import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { MailRequest } from '../../../notification/interfaces';
import { NotificationService } from '../../../notification/services/notification.service';
import { SupportIssue } from '../../entities/support-issue.entity';
import { SupportMessage } from '../../entities/support-message.entity';
import { SupportIssueNotificationService } from '../support-issue-notification.service';

describe('SupportIssueNotificationService', () => {
  let service: SupportIssueNotificationService;

  let notificationService: NotificationService;
  let userDataService: UserDataService;
  let walletService: WalletService;

  const dfxWallet = createCustomWallet({ name: 'DFX' });
  const realUnitWallet = createCustomWallet({ name: 'RealUnit' });

  beforeEach(async () => {
    notificationService = createMock<NotificationService>();
    userDataService = createMock<UserDataService>();
    walletService = createMock<WalletService>();

    jest.spyOn(walletService, 'getDefault').mockResolvedValue(dfxWallet);
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SupportIssueNotificationService,
        { provide: NotificationService, useValue: notificationService },
        { provide: UserDataService, useValue: userDataService },
        { provide: WalletService, useValue: walletService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SupportIssueNotificationService>(SupportIssueNotificationService);
  });

  // entity.userData reads from issue.userData (no wallet relation loaded, as on the auto-responder job path)
  function createSupportMessage(userData: UserData): SupportMessage {
    const issue = Object.assign(new SupportIssue(), { uid: 'I-1', userData });
    return Object.assign(new SupportMessage(), { id: 1, author: 'Support', issue });
  }

  async function sentMailInput(): Promise<MailRequest['input']> {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
    await service.newSupportMessage(createSupportMessage(createCustomUserData({ id: 7, mail: 'user@test.com' })));
    expect(sendMail).toHaveBeenCalledTimes(1);
    return sendMail.mock.calls[0][0].input;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('brands the mail by the user origin wallet, regardless of whether the caller loaded the relation', async () => {
    jest
      .spyOn(userDataService, 'getUserData')
      .mockResolvedValue(createCustomUserData({ id: 7, wallet: realUnitWallet }));

    const input = await sentMailInput();

    expect(userDataService.getUserData).toHaveBeenCalledWith(7, { wallet: true }, true);
    expect('wallet' in input && input.wallet).toBe(realUnitWallet);
    expect(walletService.getDefault).not.toHaveBeenCalled();
  });

  it('falls back to the default (DFX) wallet when the user has no origin wallet', async () => {
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(createCustomUserData({ id: 7, wallet: undefined }));

    const input = await sentMailInput();

    expect('wallet' in input && input.wallet).toBe(dfxWallet);
  });

  it('does not send a mail when the user has no mail address', async () => {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service.newSupportMessage(createSupportMessage(createCustomUserData({ id: 7, mail: undefined })));

    expect(sendMail).not.toHaveBeenCalled();
  });
});
