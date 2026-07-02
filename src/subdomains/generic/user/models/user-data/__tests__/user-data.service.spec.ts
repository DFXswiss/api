import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycNotificationService } from 'src/subdomains/generic/kyc/services/kyc-notification.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { UserDataNotificationService } from 'src/subdomains/generic/user/models/user-data/user-data-notification.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { OrganizationService } from 'src/subdomains/generic/user/models/organization/organization.service';
import { TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { CustodyService } from 'src/subdomains/core/custody/services/custody.service';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { UserData } from '../user-data.entity';
import { KycType, UserDataStatus } from '../user-data.enum';
import { UserDataRepository } from '../user-data.repository';
import { UserDataService } from '../user-data.service';
import { UserRepository } from '../../user/user.repository';

describe('UserDataService', () => {
  let service: UserDataService;
  let userDataRepo: jest.Mocked<UserDataRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let kycAdminService: jest.Mocked<KycAdminService>;
  let transactionService: jest.Mocked<TransactionService>;
  let bankDataService: jest.Mocked<BankDataService>;
  let documentService: jest.Mocked<KycDocumentService>;

  beforeEach(async () => {
    userDataRepo = createMock<UserDataRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataService,
        { provide: RepositoryFactory, useValue: createMock<RepositoryFactory>() },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserRepository, useValue: createMock<UserRepository>() },
        { provide: CountryService, useValue: createMock<CountryService>() },
        { provide: LanguageService, useValue: createMock<LanguageService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: SettingService, useValue: createMock<SettingService>() },
        { provide: KycNotificationService, useValue: createMock<KycNotificationService>() },
        { provide: KycLogService, useValue: createMock<KycLogService>() },
        { provide: UserDataNotificationService, useValue: createMock<UserDataNotificationService>() },
        { provide: AccountMergeService, useValue: createMock<AccountMergeService>() },
        { provide: SpecialExternalAccountService, useValue: createMock<SpecialExternalAccountService>() },
        { provide: SiftService, useValue: createMock<SiftService>() },
        { provide: WebhookService, useValue: createMock<WebhookService>() },
        { provide: KycDocumentService, useValue: createMock<KycDocumentService>() },
        { provide: KycAdminService, useValue: createMock<KycAdminService>() },
        { provide: OrganizationService, useValue: createMock<OrganizationService>() },
        { provide: TfaService, useValue: createMock<TfaService>() },
        { provide: TransactionService, useValue: createMock<TransactionService>() },
        { provide: BankDataService, useValue: createMock<BankDataService>() },
        { provide: KycService, useValue: createMock<KycService>() },
        { provide: IpLogService, useValue: createMock<IpLogService>() },
        { provide: CustodyService, useValue: createMock<CustodyService>() },
      ],
    }).compile();

    service = module.get(UserDataService);
    userRepo = module.get(UserRepository);
    kycAdminService = module.get(KycAdminService);
    transactionService = module.get(TransactionService);
    bankDataService = module.get(BankDataService);
    documentService = module.get(KycDocumentService);
  });

  describe('getUsersByMail', () => {
    it('matches case-insensitively via LOWER(mail) and passes a lowercased parameter', async () => {
      userDataRepo.find.mockResolvedValue([]);

      await service.getUsersByMail('Samuel.Kullmann@Startmail.com');

      const where = userDataRepo.find.mock.calls[0][0].where as { mail: FindOperator<string> };
      expect(where.mail).toBeInstanceOf(FindOperator);
      expect(where.mail.type).toBe('raw');
      // `getSql` is a getter returning the SQL generator; invoke it with the column alias
      expect(where.mail.getSql?.('"UserData"."mail"')).toBe('LOWER("UserData"."mail") = :mail');
      expect(where.mail.objectLiteralParameters).toEqual({ mail: 'samuel.kullmann@startmail.com' });
    });

    it('omits the status filter when onlyValidUser is false', async () => {
      userDataRepo.find.mockResolvedValue([]);

      await service.getUsersByMail('a@b.com', false);

      const where = userDataRepo.find.mock.calls[0][0].where as { status?: unknown };
      expect(where.status).toBeUndefined();
    });
  });

  describe('checkMail', () => {
    it('throws a conflict when another account already uses the same mail (case-insensitive)', async () => {
      const userData = Object.assign(new UserData(), { id: 1, kycType: 'DFX' });
      const conflictUser = Object.assign(new UserData(), { id: 2, kycType: 'DFX' });

      // getUsersByMail() resolves to the case-variant conflicting account
      userDataRepo.find.mockResolvedValue([conflictUser]);

      await expect(service.checkMail(userData, 'samuel.kullmann@startmail.com')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('mergeUserData kyc step renumbering', () => {
    let stepId: number;

    const buildStep = (name: KycStepName, sequenceNumber: number, status = ReviewStatus.COMPLETED): KycStep =>
      Object.assign(new KycStep(), { id: ++stepId, name, type: null, status, sequenceNumber });

    const buildAccount = (id: number, kycLevel: number): UserData =>
      Object.assign(new UserData(), {
        id,
        kycLevel,
        kycType: KycType.DFX,
        status: UserDataStatus.ACTIVE,
        accountRelations: [],
        relatedAccountRelations: [],
        supportIssues: [],
      });

    const runMerge = async (masterSteps: KycStep[], slaveSteps: KycStep[]): Promise<[number, number][]> => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);

      userDataRepo.findOne.mockResolvedValueOnce(master).mockResolvedValueOnce(slave);
      transactionService.getAllTransactionsForUserData.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);
      bankDataService.getAllBankDatasForUser.mockResolvedValue([]);
      kycAdminService.getKycSteps.mockResolvedValueOnce(masterSteps).mockResolvedValueOnce(slaveSteps);
      documentService.copyFiles.mockResolvedValue(undefined);
      jest.spyOn(service, 'updateVolumes').mockResolvedValue(undefined);
      jest
        .spyOn(service as unknown as { updateBankTxTime: () => Promise<void> }, 'updateBankTxTime')
        .mockResolvedValue(undefined);

      await service.mergeUserData(master.id, slave.id);

      // updateKycStepInternal receives KycStep.update()'s [id, partial]; extract [stepId, newSequenceNumber]
      return kycAdminService.updateKycStepInternal.mock.calls.map((c) => {
        const [id, update] = c[0] as unknown as [number, Partial<KycStep>];
        return [id, update.sequenceNumber];
      });
    };

    beforeEach(() => {
      stepId = 0;
    });

    // prod debris shape (userData 240169): repeated failed merges left same-name steps at 0, -100 … -400
    const debrisSlaveSteps = () => [
      buildStep(KycStepName.CONTACT_DATA, 0),
      buildStep(KycStepName.CONTACT_DATA, -100),
      buildStep(KycStepName.CONTACT_DATA, -200),
      buildStep(KycStepName.CONTACT_DATA, -300),
      buildStep(KycStepName.CONTACT_DATA, -400),
      buildStep(KycStepName.PERSONAL_DATA, 0),
    ];

    it('assigns numbers strictly below the minimum of both sides', async () => {
      const masterSteps = [buildStep(KycStepName.CONTACT_DATA, 0)];
      const slaveSteps = debrisSlaveSteps();

      const assigned = await runMerge(masterSteps, slaveSteps);

      expect(assigned).toHaveLength(6);
      for (const [, seq] of assigned) expect(seq).toBeLessThan(-400);
    });

    it('assigns pairwise-distinct numbers (no collision within the batch)', async () => {
      const assigned = await runMerge([buildStep(KycStepName.CONTACT_DATA, 0)], debrisSlaveSteps());

      const seqs = assigned.map(([, seq]) => seq);
      expect(new Set(seqs).size).toBe(seqs.length);
    });

    it('preserves the relative order of same-name attempts (newest keeps the highest number)', async () => {
      const slaveSteps = debrisSlaveSteps();
      // update() mutates the entities, so capture the old order before the merge runs
      const idsByOldSeqDesc = slaveSteps
        .filter((s) => s.name === KycStepName.CONTACT_DATA)
        .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
        .map((s) => s.id);

      const assigned = new Map(await runMerge([buildStep(KycStepName.CONTACT_DATA, 0)], slaveSteps));

      const newSeqs = idsByOldSeqDesc.map((id) => assigned.get(id));
      for (let i = 1; i < newSeqs.length; i++) expect(newSeqs[i - 1]).toBeGreaterThan(newSeqs[i]);
    });

    it('never lands on a pre-existing (name, sequenceNumber) tuple of either side — the prod collision', async () => {
      const masterSteps = [buildStep(KycStepName.CONTACT_DATA, 0), buildStep(KycStepName.PERSONAL_DATA, -1)];
      const slaveSteps = debrisSlaveSteps();
      const preExisting = new Set([...masterSteps, ...slaveSteps].map((s) => `${s.name}|${s.sequenceNumber}`));

      const assigned = new Map(await runMerge(masterSteps, slaveSteps));

      for (const step of slaveSteps) {
        expect(preExisting.has(`${step.name}|${assigned.get(step.id)}`)).toBe(false);
      }
    });

    it('re-running a partially-applied merge assigns fresh lower numbers (no compounding, no collision)', async () => {
      // first run assigned -401 … -406; simulate those writes having been committed
      const committedSlaveSteps = [
        buildStep(KycStepName.CONTACT_DATA, -401),
        buildStep(KycStepName.CONTACT_DATA, -403),
        buildStep(KycStepName.CONTACT_DATA, -404),
        buildStep(KycStepName.CONTACT_DATA, -405),
        buildStep(KycStepName.CONTACT_DATA, -406),
        buildStep(KycStepName.PERSONAL_DATA, -402),
      ];
      const preExisting = new Set(committedSlaveSteps.map((s) => `${s.name}|${s.sequenceNumber}`));

      const assigned = await runMerge([buildStep(KycStepName.CONTACT_DATA, 0)], committedSlaveSteps);

      for (const [id, seq] of assigned) {
        expect(seq).toBeLessThan(-406);
        expect(preExisting.has(`${committedSlaveSteps.find((s) => s.id === id).name}|${seq}`)).toBe(false);
      }
      expect(new Set(assigned.map(([, s]) => s)).size).toBe(assigned.length);
    });
  });

  describe('updateUserData', () => {
    it('does not pass kycSteps or users to save() to prevent stale-collection FK clobber', async () => {
      const fakeKycSteps = [{ id: 10 }] as UserData['kycSteps'];
      const fakeUsers = [{ id: 20 }] as UserData['users'];
      const fakeUserData = Object.assign(new UserData(), {
        id: 1,
        kycSteps: fakeKycSteps,
        users: fakeUsers,
        kycLevel: 0,
      });

      userDataRepo.findOne.mockResolvedValue(fakeUserData);
      userDataRepo.save.mockImplementation(async (e) => e as UserData);

      await service.updateUserData(1, {});

      const savedArg = userDataRepo.save.mock.calls[0][0] as Partial<UserData>;
      expect(savedArg.kycSteps).toBeUndefined();
      expect(savedArg.users).toBeUndefined();
      expect(savedArg.id).toBe(1);
    });
  });
});
