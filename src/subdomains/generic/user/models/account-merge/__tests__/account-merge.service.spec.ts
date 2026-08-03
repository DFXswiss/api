import { ConfigService } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from '../../user-data/user-data.entity';
import { UserDataService } from '../../user-data/user-data.service';
import { AccountMerge, MergeReason } from '../account-merge.entity';
import { AccountMergeRepository } from '../account-merge.repository';
import { AccountMergeService } from '../account-merge.service';

describe('AccountMergeService', () => {
  let service: AccountMergeService;

  let accountMergeRepo: jest.Mocked<Partial<AccountMergeRepository>>;
  let notificationService: jest.Mocked<Partial<NotificationService>>;
  let kycLogService: jest.Mocked<Partial<KycLogService>>;

  const buildUserData = (id: number, mail?: string): UserData => {
    const userData = Object.assign(new UserData(), { id, mail, firstname: `user${id}` });
    jest.spyOn(userData, 'isMergePossibleWith').mockReturnValue(true);
    return userData;
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    accountMergeRepo = { findOneBy: jest.fn(), save: jest.fn() };
    notificationService = { sendMail: jest.fn() };
    kycLogService = { createMergeLog: jest.fn() };

    service = new AccountMergeService(
      accountMergeRepo as unknown as AccountMergeRepository,
      notificationService as unknown as NotificationService,
      kycLogService as unknown as KycLogService,
      {} as unknown as UserDataService,
    );
  });

  describe('sendMergeRequest', () => {
    it('creates a request and sends exactly one mail when no open merge exists', async () => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      accountMergeRepo.findOneBy.mockResolvedValue(null);
      accountMergeRepo.save.mockResolvedValue(Object.assign(new AccountMerge(), { id: 10, code: 'code-10' }));

      const result = await service.sendMergeRequest(master, slave, MergeReason.IDENT_DOCUMENT);

      expect(result).toBe(true);
      expect(accountMergeRepo.save).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
    });

    it('reuses an open merge and sends no further mail (dedup across triggers), but keeps the audit log', async () => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      accountMergeRepo.findOneBy.mockResolvedValue(
        Object.assign(new AccountMerge(), { id: 10, code: 'code-10', isCompleted: false }),
      );

      const result = await service.sendMergeRequest(master, slave, MergeReason.IBAN);

      expect(result).toBe(true);
      expect(accountMergeRepo.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(kycLogService.createMergeLog).toHaveBeenCalledTimes(2);
      // the open-merge lookup only matches non-completed requests
      expect(accountMergeRepo.findOneBy).toHaveBeenCalledWith(expect.objectContaining({ isCompleted: false }));
    });

    it('scopes the dedup lookup to recently-touched open requests (re-trigger after the window gets a fresh mail)', async () => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      // a long-open request that the user re-triggers days later is outside the recency window, so the
      // DB lookup (filtered on `updated`) returns nothing and a fresh request + mail is minted.
      accountMergeRepo.findOneBy.mockResolvedValue(null);
      accountMergeRepo.save.mockResolvedValue(Object.assign(new AccountMerge(), { id: 12, code: 'code-12' }));

      const result = await service.sendMergeRequest(master, slave, MergeReason.IDENT_DOCUMENT);

      expect(result).toBe(true);
      // the dedup lookup carries the recency clause, not just isCompleted/expiration
      expect(accountMergeRepo.findOneBy).toHaveBeenCalledWith(expect.objectContaining({ updated: expect.anything() }));
      expect(accountMergeRepo.save).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
    });

    it('returns false without touching the repo when the merge is not possible', async () => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      jest.spyOn(master, 'isMergePossibleWith').mockReturnValue(false);

      const result = await service.sendMergeRequest(master, slave, MergeReason.IDENT_DOCUMENT);

      expect(result).toBe(false);
      expect(accountMergeRepo.findOneBy).not.toHaveBeenCalled();
      expect(accountMergeRepo.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('sends the mail to the slave when sendToSlave is set', async () => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      accountMergeRepo.findOneBy.mockResolvedValue(null);
      accountMergeRepo.save.mockResolvedValue(Object.assign(new AccountMerge(), { id: 11, code: 'code-11' }));

      await service.sendMergeRequest(master, slave, MergeReason.IDENT_DOCUMENT, true);

      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      const [mail] = notificationService.sendMail.mock.calls[0];
      expect((mail.input as { userData: UserData }).userData).toBe(slave);
    });

    // Only the mail merge exempts a Compliance account from the merge block (see
    // UserData.checkIfMergePossibleWith). The reason therefore has to reach the check — a hard-coded
    // false here would lock staff accounts out of their only self-service path to a verified name,
    // and a hard-coded true would silently extend the exemption to IBAN and ident-document merges.
    it.each([
      [MergeReason.MAIL, true],
      [MergeReason.IBAN, false],
      [MergeReason.IDENT_DOCUMENT, false],
    ])('passes the mail-merge flag derived from reason %s to the merge check', async (reason, expectedFlag) => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      accountMergeRepo.findOneBy.mockResolvedValue(null);
      accountMergeRepo.save.mockResolvedValue(Object.assign(new AccountMerge(), { id: 13, code: 'code-13' }));

      await service.sendMergeRequest(master, slave, reason);

      expect(master.isMergePossibleWith).toHaveBeenCalledWith(slave, expectedFlag);
    });
  });

  describe('executeMerge', () => {
    // The check runs a second time against freshly loaded entities inside mergeUserData, so a mail
    // merge that passed at request time must not be refused at confirmation time.
    it.each([
      [MergeReason.MAIL, true],
      [MergeReason.IBAN, false],
    ])('forwards the mail-merge flag for a %s merge to the execution', async (reason, expectedFlag) => {
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      const request = Object.assign(new AccountMerge(), {
        id: 20,
        code: 'code-20',
        master,
        slave,
        reason,
        // isExpired/isCompleted are getters: drive them through the columns they read.
        expiration: Util.daysAfter(1),
        isCompleted: false,
      });
      accountMergeRepo.findOne = jest.fn().mockResolvedValue(request);
      accountMergeRepo.update = jest.fn();
      const mergeUserData = jest.fn();
      (service as unknown as { userDataService: { mergeUserData: jest.Mock } }).userDataService = {
        mergeUserData,
      };

      await service.executeMerge('code-20');

      expect(mergeUserData).toHaveBeenCalledWith(master.id, slave.id, slave.mail, false, expectedFlag);
    });
  });
});
