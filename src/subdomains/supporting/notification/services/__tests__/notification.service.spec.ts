import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createCustomWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { DataSource, In } from 'typeorm';
import { Mail } from '../../entities/mail/base/mail';
import { Notification } from '../../entities/notification.entity';
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
    userRepo = { findOne: jest.fn().mockResolvedValue(undefined) };

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

  function userMailRequest(input: Record<string, unknown>, extras: Partial<MailRequest> = {}): MailRequest {
    return {
      type: MailType.USER_V2,
      context: MailContext.SUPPORT_MESSAGE,
      input,
      ...extras,
    } as unknown as MailRequest;
  }

  function createMailStub(overrides: Partial<Notification> = {}): Mail {
    const mail = Object.assign(new Mail({ to: 'a@b.c', subject: 's', templateParams: {} as any }), {
      correlationId: 'corr-1',
      context: MailContext.SUPPORT_MESSAGE,
      type: MailType.USER_V2,
      isSuppressed: jest.fn().mockReturnValue(false),
      ...overrides,
    });
    return mail;
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

  it('falls back to the account wallet when none is set and the user has no branded/preferred wallet', async () => {
    userRepo.findOne.mockResolvedValue(undefined);
    const accountWallet = createCustomWallet({ name: 'DFX' });
    const request = userMailRequest({ userData: createCustomUserData({ id: 7, wallet: accountWallet }) });

    await service.sendMail(request);

    expect((request.input as any).wallet).toBe(accountWallet);
    // A preferred/branded wallet (e.g. Denario) is configured, so the lookup runs but finds no match for this user.
    expect(userRepo.findOne).toHaveBeenCalled();
  });

  it('assigns the most recently linked preferred wallet when the caller did not set one', async () => {
    const preferred = createCustomWallet({ name: 'Denario' });
    userRepo.findOne.mockResolvedValue({ wallet: preferred });
    const accountWallet = createCustomWallet({ name: 'DFX' });
    const request = userMailRequest({ userData: createCustomUserData({ id: 11, wallet: accountWallet }) });

    await service.sendMail(request);

    expect((request.input as any).wallet).toBe(preferred);
    expect(userRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userData: { id: 11 }, wallet: { name: In(expect.arrayContaining(['Denario'])) } },
        relations: { wallet: true },
        order: { id: 'DESC' },
      }),
    );
  });

  it('skips preferred-wallet lookup when userData has no id', async () => {
    const request = userMailRequest({ userData: createCustomUserData({ id: undefined as any }) });

    await service.sendMail(request);

    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('skips preferred-wallet lookup when input has no userData', async () => {
    const request = {
      type: MailType.GENERIC,
      context: MailContext.MONITORING,
      input: { to: 'a@b.c', subject: 's', salutation: 'hi', body: 'body' },
    } as MailRequest;

    await service.sendMail(request);

    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('skips the User lookup when no preferred wallets are configured', async () => {
    const previousWallet = Config.mail.wallet;
    Config.mail.wallet = { DFX: { template: 'user-v2' } };

    try {
      const accountWallet = createCustomWallet({ name: 'DFX' });
      const request = userMailRequest({ userData: createCustomUserData({ id: 7, wallet: accountWallet }) });

      await service.sendMail(request);

      expect((request.input as any).wallet).toBe(accountWallet);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    } finally {
      Config.mail.wallet = previousWallet;
    }
  });

  it('returns without sending when the factory produces no mail', async () => {
    jest.spyOn(mailFactory, 'createMail').mockReturnValue(undefined);
    const request = userMailRequest({ userData: createCustomUserData({ id: 1 }) });

    await service.sendMail(request);

    expect(notificationRepo.save).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('saves, sends and marks complete on the happy path', async () => {
    const mail = createMailStub();
    jest.spyOn(mailFactory, 'createMail').mockReturnValue(mail);
    jest.spyOn(notificationRepo, 'findOne').mockResolvedValue(undefined);
    jest.spyOn(notificationRepo, 'save').mockImplementation(async (entity) => entity as any);
    jest.spyOn(mailService, 'send').mockResolvedValue(undefined);

    const userData = createCustomUserData({
      id: 42,
      mail: 'user@example.com',
      language: { id: 1, symbol: 'EN' } as any,
    });
    const request = userMailRequest(
      { userData, title: 't' },
      { correlationId: 'c-1', options: { debounce: 1000, suppressRecurring: true } },
    );

    await service.sendMail(request);

    expect(notificationRepo.save).toHaveBeenCalled();
    expect(mailService.send).toHaveBeenCalledWith(mail);
    expect(mail.isComplete).toBe(true);
    // fromRequest clears userData on the request input after extracting it
    expect((request.input as any).userData).toBeUndefined();
  });

  it('returns early when the mail is suppressed', async () => {
    const mail = createMailStub();
    (mail.isSuppressed as jest.Mock).mockReturnValue(true);
    jest.spyOn(mailFactory, 'createMail').mockReturnValue(mail);
    jest.spyOn(notificationRepo, 'findOne').mockResolvedValue(Object.assign(new Notification(), { id: 9 }));
    jest.spyOn(notificationRepo, 'save').mockImplementation(async (entity) => entity as any);

    const request = userMailRequest({ userData: createCustomUserData({ id: 1 }) }, { correlationId: 'c-sup' });

    await service.sendMail(request);

    expect(mailService.send).not.toHaveBeenCalled();
    // save of the new mail is skipped when suppressed
    expect(notificationRepo.save).not.toHaveBeenCalled();
  });

  it('marks incomplete and records the error when sending fails', async () => {
    const mail = createMailStub();
    jest.spyOn(mailFactory, 'createMail').mockReturnValue(mail);
    jest.spyOn(notificationRepo, 'findOne').mockResolvedValue(undefined);
    jest.spyOn(notificationRepo, 'save').mockImplementation(async (entity) => entity as any);
    const boom = new Error('smtp down');
    jest.spyOn(mailService, 'send').mockRejectedValue(boom);

    const request = userMailRequest({ userData: createCustomUserData({ id: 1 }) });

    await service.sendMail(request);

    expect(mail.isComplete).toBe(false);
    expect(mail.error).toBe(boom);
  });

  it('getMails queries by userData id', async () => {
    const rows = [Object.assign(new Notification(), { id: 1 })];
    jest.spyOn(notificationRepo, 'find').mockResolvedValue(rows);

    await expect(service.getMails(99)).resolves.toBe(rows);
    expect(notificationRepo.find).toHaveBeenCalledWith({ where: { userData: { id: 99 } } });
  });

  it('updateNotification assigns dto fields and saves', async () => {
    const entity = Object.assign(new Notification(), { id: 3, isComplete: false });
    jest.spyOn(notificationRepo, 'save').mockImplementation(async (e) => e as any);

    const result = await service.updateNotification(entity, { isComplete: true, error: undefined });

    expect(result.isComplete).toBe(true);
    expect(notificationRepo.save).toHaveBeenCalledWith(entity);
  });

  it('isSuppressed returns the entity decision when a prior notification exists', async () => {
    const existing = Object.assign(new Notification(), {
      correlationId: 'c',
      context: MailContext.LOGIN,
      lastTryDate: new Date(),
    });
    const fresh = Object.assign(new Notification(), {
      correlationId: 'c',
      context: MailContext.LOGIN,
      isSuppressed: jest.fn().mockReturnValue(true),
    });
    jest.spyOn(notificationRepo, 'findOne').mockResolvedValue(existing);

    await expect(service.isSuppressed(fresh)).resolves.toBe(true);
    expect(fresh.isSuppressed).toHaveBeenCalledWith(existing);
    expect(notificationRepo.findOne).toHaveBeenCalledWith({
      where: { correlationId: 'c', context: MailContext.LOGIN },
      order: { id: 'DESC' },
    });
  });

  it('isSuppressed returns undefined when no prior notification exists', async () => {
    const fresh = Object.assign(new Notification(), {
      correlationId: 'c',
      context: MailContext.LOGIN,
      isSuppressed: jest.fn(),
    });
    jest.spyOn(notificationRepo, 'findOne').mockResolvedValue(undefined);

    await expect(service.isSuppressed(fresh)).resolves.toBeUndefined();
    expect(fresh.isSuppressed).not.toHaveBeenCalled();
  });

  describe('fromRequest / toRequest', () => {
    it('embeds a reduced userData snapshot and clears the request input userData', () => {
      const userData = createCustomUserData({
        id: 5,
        mail: 'u@example.com',
        language: { id: 2, symbol: 'DE' } as any,
      });
      const request = userMailRequest(
        { userData, title: 'hello', extra: true },
        { correlationId: 'corr', options: { debounce: 50, suppressRecurring: true } },
      );

      const partial = NotificationService.fromRequest(request);

      expect(partial.type).toBe(MailType.USER_V2);
      expect(partial.context).toBe(MailContext.SUPPORT_MESSAGE);
      expect(partial.correlationId).toBe('corr');
      expect(partial.debounce).toBe(50);
      expect(partial.suppressRecurring).toBe(true);
      expect(partial.userData).toBe(userData);
      const data = JSON.parse(partial.data as string);
      expect(data.userData).toEqual({ id: 5, mail: 'u@example.com', language: { id: 2, symbol: 'DE' } });
      expect(data.title).toBe('hello');
      expect((request.input as any).userData).toBeUndefined();
    });

    it('stringifies input without a userData projection when input has no userData', () => {
      const request = {
        type: MailType.GENERIC,
        context: MailContext.MONITORING,
        input: { to: 'a@b.c', subject: 's', salutation: 'hi', body: 'body' },
        correlationId: 'g-1',
      } as MailRequest;

      const partial = NotificationService.fromRequest(request);

      expect(partial.userData).toBeUndefined();
      expect(JSON.parse(partial.data as string)).toEqual(request.input);
    });

    it('rebuilds a MailRequest from a stored notification', () => {
      const notification = Object.assign(new Notification(), {
        type: MailType.USER_V2,
        context: MailContext.LOGIN,
        data: JSON.stringify({ title: 't' }),
        correlationId: 'c-9',
        suppressRecurring: true,
        debounce: 200,
      });

      expect(NotificationService.toRequest(notification)).toEqual({
        type: MailType.USER_V2,
        context: MailContext.LOGIN,
        input: { title: 't' },
        correlationId: 'c-9',
        options: { suppressRecurring: true, debounce: 200 },
      });
    });

    it('maps stored data "-" to null input', () => {
      const notification = Object.assign(new Notification(), {
        type: MailType.GENERIC,
        context: MailContext.MONITORING,
        data: '-',
        correlationId: undefined,
        suppressRecurring: false,
        debounce: undefined,
      });

      expect(NotificationService.toRequest(notification).input).toBeNull();
    });
  });
});
