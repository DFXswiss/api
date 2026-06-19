import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
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

  function createSupportMessage(userData: UserData, issueWallet?: Wallet): SupportMessage {
    const issue = Object.assign(new SupportIssue(), { uid: 'I-1', userData, wallet: issueWallet });
    return Object.assign(new SupportMessage(), { id: 1, author: 'Support', issue });
  }

  async function sentMailInput(issueWallet?: Wallet): Promise<MailRequest['input']> {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
    const userData = createCustomUserData({ id: 7, mail: 'user@test.com' });
    await service.newSupportMessage(createSupportMessage(userData, issueWallet));
    expect(sendMail).toHaveBeenCalledTimes(1);
    return sendMail.mock.calls[0][0].input;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('brands the mail by the wallet the issue was opened from, ignoring the account origin', async () => {
    // issue opened from RealUnit, but the account originates from DFX -> ticket source wins
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(createCustomUserData({ id: 7, wallet: dfxWallet }));

    const input = await sentMailInput(realUnitWallet);

    expect('wallet' in input && input.wallet).toBe(realUnitWallet);
    expect(userDataService.getUserData).not.toHaveBeenCalled();
    expect(walletService.getDefault).not.toHaveBeenCalled();
  });

  it('falls back to the account origin wallet when the issue has no source (legacy/support-created)', async () => {
    jest
      .spyOn(userDataService, 'getUserData')
      .mockResolvedValue(createCustomUserData({ id: 7, wallet: realUnitWallet }));

    const input = await sentMailInput(undefined);

    expect(userDataService.getUserData).toHaveBeenCalledWith(7, { wallet: true }, true);
    expect('wallet' in input && input.wallet).toBe(realUnitWallet);
    expect(walletService.getDefault).not.toHaveBeenCalled();
  });

  it('falls back to the default (DFX) wallet when neither issue source nor account origin is set', async () => {
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(createCustomUserData({ id: 7, wallet: undefined }));

    const input = await sentMailInput(undefined);

    expect('wallet' in input && input.wallet).toBe(dfxWallet);
  });

  it('does not send a mail when the user has no mail address', async () => {
    const sendMail = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service.newSupportMessage(createSupportMessage(createCustomUserData({ id: 7, mail: undefined })));

    expect(sendMail).not.toHaveBeenCalled();
  });
});
