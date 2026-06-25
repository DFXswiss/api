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
  let userDataService: jest.Mocked<Partial<UserDataService>>;

  const buildUserData = (id: number, mail?: string): UserData => {
    const userData = Object.assign(new UserData(), { id, mail, firstname: `user${id}` });
    jest.spyOn(userData, 'isMergePossibleWith').mockReturnValue(true);
    return userData;
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    accountMergeRepo = { findOneBy: jest.fn(), save: jest.fn(), findOne: jest.fn(), update: jest.fn() };
    notificationService = { sendMail: jest.fn() };
    kycLogService = { createMergeLog: jest.fn() };
    userDataService = { mergeUserData: jest.fn() };

    service = new AccountMergeService(
      accountMergeRepo as unknown as AccountMergeRepository,
      notificationService as unknown as NotificationService,
      kycLogService as unknown as KycLogService,
      userDataService as unknown as UserDataService,
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
  });

  describe('executeMerge', () => {
    const buildRequest = (master: UserData, slave: UserData): AccountMerge =>
      Object.assign(new AccountMerge(), {
        id: 20,
        code: 'code-20',
        master,
        slave,
        isCompleted: false,
        expiration: Util.daysAfter(30),
      });

    it('merges with notifyUser=true so the master is notified about the confirmed merge', async () => {
      // master is the account with an ident document; the slave's mailbox confirmed the merge.
      // Without notifyUser=true the master (the account being merged into) would never be told.
      const master = buildUserData(1, 'master@test.com');
      const slave = buildUserData(2, 'slave@test.com');
      Object.assign(master, { identDocumentId: 'DOC-1' });
      accountMergeRepo.findOne.mockResolvedValue(buildRequest(master, slave));

      await service.executeMerge('code-20');

      expect(userDataService.mergeUserData).toHaveBeenCalledTimes(1);
      expect(userDataService.mergeUserData).toHaveBeenCalledWith(master.id, slave.id, slave.mail, true);
    });
  });
});
