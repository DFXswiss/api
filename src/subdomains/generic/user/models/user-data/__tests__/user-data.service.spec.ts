import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { FindOperator, IsNull, Not } from 'typeorm';
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
import { MergedPrefix, UserDataService } from '../user-data.service';
import { UpdateMailStatus } from '../../user/dto/verify-mail.dto';
import { UserRepository } from '../../user/user.repository';

// Config is only initialized at app bootstrap; provide the kycHash format used by getByKycHashOrThrow
jest.mock('src/config/config', () => ({
  ...jest.requireActual('src/config/config'),
  Config: { formats: { kycHash: /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i } },
}));

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

      await service.getUsersByMail('John.Smith@Example.com');

      const where = userDataRepo.find.mock.calls[0][0].where as { mail: FindOperator<string> };
      expect(where.mail).toBeInstanceOf(FindOperator);
      expect(where.mail.type).toBe('raw');
      // `getSql` is a getter returning the SQL generator; invoke it with the column alias
      expect(where.mail.getSql?.('"UserData"."mail"')).toBe('LOWER("UserData"."mail") = :mail');
      expect(where.mail.objectLiteralParameters).toEqual({ mail: 'john.smith@example.com' });
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

      await expect(service.checkMail(userData, 'john.smith@example.com')).rejects.toBeInstanceOf(ConflictException);
    });

    it('redirects a merged account to the master code instead of raising a conflict (prod retry storm)', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.MERGED,
        firstname: 'Merged into 398950',
      });
      const master = Object.assign(new UserData(), { id: 398950, kycHash: 'F1D96261-F27E-4772-B2E1-47B356F4D7A5' });

      userDataRepo.findOne.mockResolvedValue(master);

      await expect(service.checkMail(userData, 'a@b.com')).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ switchToCode: master.kycHash }),
      });
      // never reaches the conflict path: no mail lookup, no merge request, no ContactData step failure
      expect(userDataRepo.find).not.toHaveBeenCalled();
    });

    it('rejects a merged account with an unresolvable master as bad request', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.MERGED,
        firstname: 'no master reference',
      });

      await expect(service.checkMail(userData, 'a@b.com')).rejects.toMatchObject({ status: 400 });
      expect(userDataRepo.find).not.toHaveBeenCalled();
    });

    it('rejects a merged account with a null firstname as bad request (no TypeError from .replace)', async () => {
      const userData = Object.assign(new UserData(), {
        id: 1,
        status: UserDataStatus.MERGED,
        firstname: null,
      });

      await expect(service.checkMail(userData, 'a@b.com')).rejects.toMatchObject({ status: 400 });
      expect(userDataRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getByKycHashOrThrow', () => {
    it('still redirects merged accounts with the master code after the throwIfMerged extraction', async () => {
      const kycHash = 'A1B96261-F27E-4772-B2E1-47B356F4D7A5';
      const merged = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.MERGED,
        firstname: 'Merged into 398950',
      });
      const master = Object.assign(new UserData(), { id: 398950, kycHash: 'F1D96261-F27E-4772-B2E1-47B356F4D7A5' });

      userDataRepo.findOne.mockResolvedValueOnce(merged).mockResolvedValueOnce(master);

      await expect(service.getByKycHashOrThrow(kycHash)).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ switchToCode: master.kycHash }),
      });
    });
  });

  describe('updateUserMail', () => {
    it('redirects a merged account to the master code through the mail-update entry point', async () => {
      const master = Object.assign(new UserData(), {
        id: 398950,
        kycHash: 'F1D96261-F27E-4772-B2E1-47B356F4D7A5',
        status: UserDataStatus.ACTIVE,
      });
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.MERGED,
        firstname: `${MergedPrefix}${master.id}`,
      });

      userDataRepo.findOne.mockResolvedValue(master);

      await expect(service.updateUserMail(userData, { mail: 'new@mail.com' }, '1.2.3.4')).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ message: 'User is merged', switchToCode: master.kycHash }),
      });
      // the merged guard short-circuits before the mail-conflict lookup and the mail write
      expect(userDataRepo.find).not.toHaveBeenCalled();
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    it('proceeds through the normal mail-set path for a non-merged account', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: null,
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);

      const result = await service.updateUserMail(userData, { mail: 'new@mail.com' }, '1.2.3.4');

      expect(result).toBe(UpdateMailStatus.Ok);
      expect(userDataRepo.update).toHaveBeenCalledWith(userData.id, { mail: 'new@mail.com' });
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
      // first run seeded 100 below the -400 floor and assigned -500 … -505; simulate those writes committed
      const committedSlaveSteps = [
        buildStep(KycStepName.CONTACT_DATA, -500),
        buildStep(KycStepName.CONTACT_DATA, -502),
        buildStep(KycStepName.CONTACT_DATA, -503),
        buildStep(KycStepName.CONTACT_DATA, -504),
        buildStep(KycStepName.CONTACT_DATA, -505),
        buildStep(KycStepName.PERSONAL_DATA, -501),
      ];
      const preExisting = new Set(committedSlaveSteps.map((s) => `${s.name}|${s.sequenceNumber}`));

      const assigned = await runMerge([buildStep(KycStepName.CONTACT_DATA, 0)], committedSlaveSteps);

      for (const [id, seq] of assigned) {
        expect(seq).toBeLessThan(-505);
        expect(preExisting.has(`${committedSlaveSteps.find((s) => s.id === id).name}|${seq}`)).toBe(false);
      }
      expect(new Set(assigned.map(([, s]) => s)).size).toBe(assigned.length);
    });
  });

  describe('assignNextKycFileId', () => {
    it('starts at 1 when no user has a kycFileId yet', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });

      userDataRepo.findOne.mockResolvedValue(null); // max lookup: table empty
      userDataRepo.findOneBy.mockResolvedValue(null); // uniqueness check: no conflict
      userDataRepo.update.mockResolvedValue(undefined);

      const result = await service.assignNextKycFileId(userData);

      expect(result.kycFileId).toBe(1);
    });

    it('assigns the real max + 1 (excluding nulls, not just the last-inserted row)', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });

      userDataRepo.findOne.mockResolvedValue(Object.assign(new UserData(), { kycFileId: 6076 }));
      userDataRepo.findOneBy.mockResolvedValue(null);
      userDataRepo.update.mockResolvedValue(undefined);

      const result = await service.assignNextKycFileId(userData);

      expect(userDataRepo.findOne.mock.calls[0][0].where).toEqual({ kycFileId: Not(IsNull()) });
      expect(result.kycFileId).toBe(6077);
    });

    it('retries with a fresh max when it loses a concurrent assignment race', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      const winner = Object.assign(new UserData(), { id: 2, kycFileId: 6077 });

      userDataRepo.findOne
        .mockResolvedValueOnce(Object.assign(new UserData(), { kycFileId: 6076 })) // attempt 0: stale max
        .mockResolvedValueOnce(Object.assign(new UserData(), { kycFileId: 6077 })); // attempt 1: winner's row now visible
      userDataRepo.findOneBy
        .mockResolvedValueOnce(winner) // attempt 0: 6077 already taken by the concurrent winner
        .mockResolvedValueOnce(null); // attempt 1: 6078 is free
      userDataRepo.update.mockResolvedValue(undefined);

      const result = await service.assignNextKycFileId(userData);

      expect(result.kycFileId).toBe(6078);
      expect(userDataRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('gives up and rethrows after repeated concurrent conflicts', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });

      userDataRepo.findOne.mockResolvedValue(Object.assign(new UserData(), { kycFileId: 6076 }));
      userDataRepo.findOneBy.mockResolvedValue(Object.assign(new UserData(), { id: 2 })); // always conflicts

      await expect(service.assignNextKycFileId(userData)).rejects.toBeInstanceOf(ConflictException);
      expect(userDataRepo.findOne).toHaveBeenCalledTimes(5); // initial attempt + 4 retries
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
