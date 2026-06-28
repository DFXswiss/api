import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createCustomWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { DataSource } from 'typeorm';
import { MailContext, MailType } from '../../enums';
import { MailFactory } from '../../factories/mail.factory';
import { MailRequest } from '../../interfaces';
import { NotificationRepository } from '../../repositories/notification.repository';
import { MailService } from '../mail.service';
import { NotificationService } from '../notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  let mailFactory: MailFactory;
  let mailService: MailService;
  let notificationRepo: NotificationRepository;
  let dataSource: DataSource;
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    mailFactory = createMock<MailFactory>();
    mailService = createMock<MailService>();
    notificationRepo = createMock<NotificationRepository>();
    dataSource = createMock<DataSource>();
    userRepo = { findOne: jest.fn() };

    jest.spyOn(dataSource, 'getRepository').mockReturnValue(userRepo as any);
    // short-circuit sendMail right after resolveMailWallet so only the wallet resolution runs
    jest.spyOn(mailFactory, 'createMail').mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        NotificationService,
        { provide: MailFactory, useValue: mailFactory },
        { provide: MailService, useValue: mailService },
        { provide: NotificationRepository, useValue: notificationRepo },
        { provide: DataSource, useValue: dataSource },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  function userMailRequest(input: Record<string, unknown>): MailRequest {
    return { type: MailType.USER_V2, context: MailContext.SUPPORT_MESSAGE, input } as unknown as MailRequest;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // locks in the safeguard our support-mail fix relies on (resolveMailWallet: `if (input.wallet) return`)
  it('keeps an explicitly set wallet and skips the account-history override', async () => {
    const realUnitWallet = createCustomWallet({ name: 'RealUnit' });
    const request = userMailRequest({ userData: createCustomUserData({ id: 7 }), wallet: realUnitWallet });

    await service.sendMail(request);

    expect((request.input as any).wallet).toBe(realUnitWallet);
    expect(dataSource.getRepository).not.toHaveBeenCalled();
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('falls back to the account wallet when none is set and no preferred wallet is configured', async () => {
    const accountWallet = createCustomWallet({ name: 'DFX' });
    const request = userMailRequest({ userData: createCustomUserData({ id: 7, wallet: accountWallet }) });

    await service.sendMail(request);

    expect((request.input as any).wallet).toBe(accountWallet);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });
});
