import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataType, newDb } from 'pg-mem';
import {
  Column,
  DataSource,
  Entity,
  EntityManager,
  FindOperator,
  FindOptionsWhere,
  IsNull,
  JoinColumn,
  ManyToOne,
  Not,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
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
import { TfaLevel, TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { TfaRequiredException } from 'src/subdomains/generic/kyc/exceptions/tfa-required.exception';
import { Util } from 'src/shared/utils/util';
import { CustodyService } from 'src/subdomains/core/custody/services/custody.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import {
  MERGE_SUPERSEDED_MARKER,
  VirtualIbanService,
} from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { VirtualIban, VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanIssuanceIntentStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent.entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycLogType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { UserData } from '../user-data.entity';
import { KycStatus, KycType, UserDataStatus } from '../user-data.enum';
import { UserDataRepository } from '../user-data.repository';
import {
  MERGE_POST_COMMIT_EFFECT_COMPLETED_MARKER,
  MERGE_POST_COMMIT_EFFECT_FAILED_MARKER,
  MERGE_POST_COMMIT_EFFECTS_PENDING_MARKER,
  MergedPrefix,
  UserDataService,
} from '../user-data.service';
import { UpdateMailStatus } from '../../user/dto/verify-mail.dto';
import { UserRepository } from '../../user/user.repository';

// Config is only initialized at app bootstrap; provide the kycHash format used by getByKycHashOrThrow
jest.mock('src/config/config', () => ({
  ...jest.requireActual('src/config/config'),
  Config: { formats: { kycHash: /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i } },
}));

@Entity({ name: 'merge_user_data' })
class MergeUserDataTable {
  @PrimaryColumn({ type: 'integer' })
  id: number;

  @OneToMany(() => MergeVirtualIbanTable, (virtualIban) => virtualIban.userData)
  virtualIbans?: MergeVirtualIbanTable[];
}

@Entity({ name: 'merge_virtual_iban' })
class MergeVirtualIbanTable {
  @PrimaryColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'varchar', length: 256 })
  provider: IbanBankName;

  @ManyToOne(() => MergeUserDataTable, (userData) => userData.virtualIbans, { nullable: false })
  @JoinColumn({ name: 'userDataId' })
  userData: MergeUserDataTable;
}

describe('UserDataService', () => {
  let service: UserDataService;
  let userDataRepo: jest.Mocked<UserDataRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let kycAdminService: jest.Mocked<KycAdminService>;
  let transactionService: jest.Mocked<TransactionService>;
  let bankDataService: jest.Mocked<BankDataService>;
  let virtualIbanService: jest.Mocked<VirtualIbanService>;
  let documentService: jest.Mocked<KycDocumentService>;
  let kycLogService: jest.Mocked<KycLogService>;
  let kycNotificationService: jest.Mocked<KycNotificationService>;
  let kycService: jest.Mocked<KycService>;
  let userDataNotificationService: jest.Mocked<UserDataNotificationService>;
  let webhookService: jest.Mocked<WebhookService>;
  let tfaService: jest.Mocked<TfaService>;
  let mergeManager: EntityManager;

  beforeEach(async () => {
    userDataRepo = createMock<UserDataRepository>();
    mergeManager = createMock<EntityManager>();
    Object.defineProperty(userDataRepo, 'manager', { value: mergeManager });
    userRepo = createMock<UserRepository>();
    (mergeManager.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === UserData) return userDataRepo;
      return userRepo;
    });
    (mergeManager.transaction as jest.Mock).mockImplementation(async (run: (manager: EntityManager) => unknown) =>
      run(mergeManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataService,
        { provide: RepositoryFactory, useValue: createMock<RepositoryFactory>() },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserRepository, useValue: userRepo },
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
        { provide: VirtualIbanService, useValue: createMock<VirtualIbanService>() },
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
    virtualIbanService = module.get(VirtualIbanService);
    documentService = module.get(KycDocumentService);
    kycLogService = module.get(KycLogService);
    kycNotificationService = module.get(KycNotificationService);
    kycService = module.get(KycService);
    userDataNotificationService = module.get(UserDataNotificationService);
    webhookService = module.get(WebhookService);
    tfaService = module.get(TfaService);
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

    it('accepts a re-submit of the address already on the account without demanding 2FA', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        // mixed case belongs on the stored side: legacy rows predate lowercase-on-write, while the
        // DTO transform already lowercases anything incoming
        mail: 'User@Example.com',
        users: [],
      });

      userDataRepo.find.mockResolvedValue([userData]);

      const result = await service.updateUserMail(userData, { mail: 'user@example.com' }, '1.2.3.4');

      expect(result).toBe(UpdateMailStatus.Ok);
      expect(tfaService.checkVerification).not.toHaveBeenCalled();
      expect(tfaService.sendVerificationMail).not.toHaveBeenCalled();
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    // pins that the unchanged-address short-circuit sits after checkMail (#4092)
    it('redirects a merged account even when the submitted address is the one already stored', async () => {
      const master = Object.assign(new UserData(), {
        id: 398950,
        kycHash: 'F1D96261-F27E-4772-B2E1-47B356F4D7A5',
        status: UserDataStatus.ACTIVE,
      });
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.MERGED,
        firstname: `${MergedPrefix}${master.id}`,
        mail: 'same@example.com',
        users: [],
      });

      userDataRepo.findOne.mockResolvedValue(master);

      await expect(service.updateUserMail(userData, { mail: 'same@example.com' }, '1.2.3.4')).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ switchToCode: master.kycHash }),
      });
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    it('still demands 2FA when the address actually changes', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'old@example.com',
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);
      tfaService.checkVerification.mockRejectedValue(new TfaRequiredException(TfaLevel.BASIC));

      await expect(service.updateUserMail(userData, { mail: 'new@example.com' }, '1.2.3.4')).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ code: 'TFA_REQUIRED', level: 'basic' }),
      });
      expect(tfaService.checkVerification).toHaveBeenCalledWith(userData, '1.2.3.4', TfaLevel.BASIC);
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('mail change log', () => {
    it('logs the previous address instead of old === new', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'old@example.com',
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);

      await service.trySetUserMail(userData, 'new@example.com');

      expect(kycLogService.createMailChangeLog).toHaveBeenCalledWith(userData, 'old@example.com', 'new@example.com');
    });

    it('writes no log when the stored address differs only in case', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'User@Example.com',
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);

      await service.trySetUserMail(userData, 'user@example.com');

      expect(kycLogService.createMailChangeLog).not.toHaveBeenCalled();
      expect(userDataRepo.update).toHaveBeenCalledWith(userData.id, { mail: 'user@example.com' });
    });

    it('writes no log for an initial assignment, which is not a change', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: null,
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);

      await service.trySetUserMail(userData, 'new@example.com');

      expect(kycLogService.createMailChangeLog).not.toHaveBeenCalled();
      expect(userDataRepo.update).toHaveBeenCalledWith(userData.id, { mail: 'new@example.com' });
    });

    it('leaves the stored address untouched when the log write fails', async () => {
      const userData = Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'old@example.com',
        users: [],
      });

      userDataRepo.find.mockResolvedValue([]);
      kycLogService.createMailChangeLog.mockRejectedValue(new Error('log write failed'));

      await expect(service.trySetUserMail(userData, 'new@example.com')).rejects.toThrow('log write failed');

      expect(userDataRepo.update).not.toHaveBeenCalled();
      expect(userData.mail).toBe('old@example.com');
    });
  });

  describe('verifyUserMail', () => {
    const secret = '123456';

    // the Util spies below are on a static class and would otherwise leak into the next test
    afterEach(() => jest.restoreAllMocks());

    const startMailChange = async (userData: UserData): Promise<void> => {
      userDataRepo.find.mockResolvedValue([]);
      jest.spyOn(Util, 'randomIdString').mockReturnValue(secret);

      await expect(service.updateUserMail(userData, { mail: 'new@example.com' }, '1.2.3.4')).resolves.toBe(
        UpdateMailStatus.Accepted,
      );
    };

    const buildUserData = (): UserData =>
      Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'old@example.com',
        users: [],
      });

    it('rejects a code whose stored expiry has passed', async () => {
      const userData = buildUserData();
      jest.spyOn(Util, 'minutesAfter').mockReturnValue(new Date(Date.now() - 1000));

      await startMailChange(userData);

      await expect(service.verifyUserMail(userData, secret)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    // literal counts, not the service constant — in terms of the constant these stay green at a cap of 1
    it('still accepts the correct code on the fifth and last allowed attempt', async () => {
      const userData = buildUserData();

      await startMailChange(userData);

      for (let i = 0; i < 4; i++) {
        await expect(service.verifyUserMail(userData, '000000')).rejects.toBeInstanceOf(ForbiddenException);
      }

      await service.verifyUserMail(userData, secret);

      expect(userDataRepo.update).toHaveBeenCalledWith(userData.id, { mail: 'new@example.com' });
    });

    it('stops accepting the correct code after five wrong attempts', async () => {
      const userData = buildUserData();

      await startMailChange(userData);

      for (let i = 0; i < 5; i++) {
        await expect(service.verifyUserMail(userData, '000000')).rejects.toBeInstanceOf(ForbiddenException);
      }

      await expect(service.verifyUserMail(userData, secret)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    it('drops a pending change when the current address is re-submitted', async () => {
      const userData = buildUserData();

      await startMailChange(userData);

      await expect(service.updateUserMail(userData, { mail: 'old@example.com' }, '1.2.3.4')).resolves.toBe(
        UpdateMailStatus.Ok,
      );

      await expect(service.verifyUserMail(userData, secret)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    it('applies the change for a valid code within the window', async () => {
      const userData = buildUserData();

      await startMailChange(userData);

      await service.verifyUserMail(userData, secret);

      expect(userDataRepo.update).toHaveBeenCalledWith(userData.id, { mail: 'new@example.com' });
    });
  });

  describe('processCleanupMailSecretCache', () => {
    const buildUserData = (): UserData =>
      Object.assign(new UserData(), {
        id: 397899,
        status: UserDataStatus.ACTIVE,
        mail: 'old@example.com',
        users: [],
      });

    // the Util spies below are on a static class and would otherwise leak into the next test
    afterEach(() => jest.restoreAllMocks());

    it('evicts an entry whose expiry has passed', async () => {
      const userData = buildUserData();
      jest.spyOn(Util, 'minutesAfter').mockReturnValue(new Date(Date.now() - 1000));
      userDataRepo.find.mockResolvedValue([]);
      jest.spyOn(Util, 'randomIdString').mockReturnValue('123456');

      await service.updateUserMail(userData, { mail: 'new@example.com' }, '1.2.3.4');

      expect(service['secretCache'].size).toBe(1);

      service.processCleanupMailSecretCache();

      expect(service['secretCache'].size).toBe(0);
    });

    it('keeps an entry that is still within its window', async () => {
      const userData = buildUserData();
      userDataRepo.find.mockResolvedValue([]);
      jest.spyOn(Util, 'randomIdString').mockReturnValue('123456');

      await service.updateUserMail(userData, { mail: 'new@example.com' }, '1.2.3.4');

      service.processCleanupMailSecretCache();

      expect(service['secretCache'].size).toBe(1);
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
      virtualIbanService.getFrickVirtualIbansForAccount.mockResolvedValue([]);
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

    it('runs DFX approval only after the atomic merge commits', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const slaveStep = buildStep(KycStepName.CONTACT_DATA, 0);
      let transactionActive = false;
      let committed = false;

      userDataRepo.findOne.mockResolvedValueOnce(master).mockResolvedValueOnce(slave);
      transactionService.getAllTransactionsForUserData.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);
      bankDataService.getAllBankDatasForUser.mockResolvedValue([]);
      virtualIbanService.getFrickVirtualIbansForAccount.mockResolvedValue([]);
      kycAdminService.getKycSteps.mockResolvedValueOnce([]).mockResolvedValueOnce([slaveStep]);
      documentService.copyFiles.mockResolvedValue(undefined);
      jest.spyOn(service, 'updateVolumes').mockResolvedValue(undefined);
      jest
        .spyOn(service as unknown as { updateBankTxTime: () => Promise<void> }, 'updateBankTxTime')
        .mockResolvedValue(undefined);
      (mergeManager.transaction as jest.Mock).mockImplementation(
        async (run: (manager: EntityManager) => Promise<unknown>) => {
          transactionActive = true;
          const result = await run(mergeManager);
          transactionActive = false;
          committed = true;
          return result;
        },
      );
      kycService.checkDfxApproval.mockImplementation(async () => {
        expect(transactionActive).toBe(false);
        expect(committed).toBe(true);
      });
      virtualIbanService.invalidateCacheAfterMerge.mockImplementation(() => {
        expect(transactionActive).toBe(false);
        expect(committed).toBe(true);
      });

      await service.mergeUserData(master.id, slave.id);

      expect(kycService.checkDfxApproval).toHaveBeenCalledWith(master);
      expect(virtualIbanService.invalidateCacheAfterMerge).toHaveBeenCalledTimes(1);
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

  describe('mergeUserData virtual IBAN reassignment', () => {
    const eur = { id: 1, name: 'EUR' };
    const chf = { id: 2, name: 'CHF' };
    const frick = { id: 10, name: IbanBankName.FRICK };
    const yapeal = { id: 11, name: IbanBankName.YAPEAL };

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

    const buildActiveViban = (
      id: number,
      userData: UserData,
      currency: { id: number; name: string },
      bank: { id: number; name: string },
      buy: { id: number } | null = null,
      iban?: string,
    ): VirtualIban =>
      Object.assign(new VirtualIban(), {
        id,
        userData,
        currency,
        bank,
        buy,
        iban: iban ?? `LI21088110100111K${String(id).padStart(3, '0')}E`,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });

    const prepareMerge = async (
      master: UserData,
      slave: UserData,
      masterVibans: VirtualIban[],
      slaveVibans: VirtualIban[],
    ): Promise<void> => {
      userDataRepo.findOne.mockResolvedValueOnce(master).mockResolvedValueOnce(slave);
      transactionService.getAllTransactionsForUserData.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);
      bankDataService.getAllBankDatasForUser.mockResolvedValue([]);
      virtualIbanService.getFrickVirtualIbansForAccount
        .mockResolvedValueOnce(masterVibans.filter((viban) => viban.bank.name === IbanBankName.FRICK))
        .mockResolvedValueOnce(slaveVibans.filter((viban) => viban.bank.name === IbanBankName.FRICK));
      // Default mock: apply deactivations only. Tests that cover intent coordination install a
      // richer mock that also resets matching Completed intents and fails non-terminal slave rows.
      virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async (_masterId, _slaveId, deactivations) => {
        for (const { virtualIban } of deactivations) {
          virtualIban.active = false;
          virtualIban.status = VirtualIbanStatus.DEACTIVATED;
          virtualIban.deactivatedAt = new Date();
        }
      });
      kycAdminService.getKycSteps.mockResolvedValue([]);
      documentService.copyFiles.mockResolvedValue(undefined);
      jest.spyOn(service, 'updateVolumes').mockResolvedValue(undefined);
      jest
        .spyOn(service as unknown as { updateBankTxTime: () => Promise<void> }, 'updateBankTxTime')
        .mockResolvedValue(undefined);
    };

    describe('merge-base virtual IBAN constellations (Postgres semantics)', () => {
      let pgDataSource: DataSource;

      beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
          name: 'version',
          returns: DataType.text,
          implementation: () => 'PostgreSQL 15.0',
        });
        db.public.registerFunction({
          name: 'current_database',
          returns: DataType.text,
          implementation: () => 'test',
        });
        pgDataSource = (await db.adapters.createTypeormDataSource({
          type: 'postgres',
          entities: [MergeUserDataTable, MergeVirtualIbanTable],
          synchronize: true,
        })) as DataSource;
        await pgDataSource.initialize();
      });

      afterAll(async () => {
        if (pgDataSource?.isInitialized) await pgDataSource.destroy();
      });

      it.each([
        {
          constellation: 'no virtual IBANs',
          masterProviders: [] as IbanBankName[],
          slaveProviders: [] as IbanBankName[],
          expectedOwnerIds: [] as number[],
        },
        {
          constellation: 'Yapeal on master',
          masterProviders: [IbanBankName.YAPEAL],
          slaveProviders: [] as IbanBankName[],
          expectedOwnerIds: [1000],
        },
        {
          constellation: 'Yapeal on slave',
          masterProviders: [] as IbanBankName[],
          slaveProviders: [IbanBankName.YAPEAL],
          expectedOwnerIds: [2000],
        },
        {
          constellation: 'Yapeal on both',
          masterProviders: [IbanBankName.YAPEAL],
          slaveProviders: [IbanBankName.YAPEAL],
          expectedOwnerIds: [1000, 2000],
        },
        {
          constellation: 'Frick on master',
          masterProviders: [IbanBankName.FRICK],
          slaveProviders: [] as IbanBankName[],
          expectedOwnerIds: [1000],
        },
        {
          constellation: 'Frick on slave',
          masterProviders: [] as IbanBankName[],
          slaveProviders: [IbanBankName.FRICK],
          expectedOwnerIds: [1000],
        },
        {
          constellation: 'Frick on both',
          masterProviders: [IbanBankName.FRICK],
          slaveProviders: [IbanBankName.FRICK],
          expectedOwnerIds: [1000, 1000],
        },
      ])(
        'preserves merge-base ownership and applies only the Frick addition: $constellation',
        async ({ masterProviders, slaveProviders, expectedOwnerIds }) => {
          const master = buildAccount(1000, 50);
          const slave = buildAccount(2000, 20);
          const allProviders = [...masterProviders, ...slaveProviders];
          const masterVibans = masterProviders.map((provider, index) =>
            buildActiveViban(
              index + 1,
              master,
              index === 0 ? eur : chf,
              provider === IbanBankName.FRICK ? frick : yapeal,
            ),
          );
          const slaveVibans = slaveProviders.map((provider, index) =>
            buildActiveViban(
              masterProviders.length + index + 1,
              slave,
              masterProviders.length === 0 ? eur : chf,
              provider === IbanBankName.FRICK ? frick : yapeal,
            ),
          );

          await pgDataSource.query(`DELETE FROM "merge_virtual_iban"`);
          await pgDataSource.query(`DELETE FROM "merge_user_data"`);
          await pgDataSource.getRepository(MergeUserDataTable).save([{ id: master.id }, { id: slave.id }]);
          await pgDataSource.getRepository(MergeVirtualIbanTable).save(
            allProviders.map((provider, index) => ({
              id: index + 1,
              provider,
              userData: { id: index < masterProviders.length ? master.id : slave.id },
            })),
          );

          await prepareMerge(master, slave, masterVibans, slaveVibans);
          virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async (masterId, slaveId) => {
            await pgDataSource.query(
              `UPDATE "merge_virtual_iban"
                  SET "userDataId" = $1
                WHERE "userDataId" = $2
                  AND "provider" = $3`,
              [masterId, slaveId, IbanBankName.FRICK],
            );
          });
          userDataRepo.save.mockImplementation(async (entity) => {
            const persistedMaster = Object.assign(new MergeUserDataTable(), { id: entity.id });
            if (entity.virtualIbans !== undefined) {
              persistedMaster.virtualIbans = entity.virtualIbans.map((virtualIban) =>
                Object.assign(new MergeVirtualIbanTable(), { id: virtualIban.id }),
              );
            }
            await pgDataSource.getRepository(MergeUserDataTable).save(persistedMaster);
            return entity as UserData;
          });

          await expect(service.mergeUserData(master.id, slave.id)).resolves.toBeUndefined();

          const rows = await pgDataSource.getRepository(MergeVirtualIbanTable).find({
            relations: { userData: true },
            order: { id: 'ASC' },
          });
          expect(rows.map((row) => row.userData.id)).toEqual(expectedOwnerIds);
          expect((userDataRepo.save.mock.calls[0][0] as UserData).virtualIbans).toBeUndefined();
        },
      );
    });

    it('does not load or reassign a single-sided Yapeal IBAN during account merge', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const masterViban = buildActiveViban(11, master, eur, frick);
      const slaveViban = buildActiveViban(22, slave, chf, yapeal);

      await prepareMerge(master, slave, [masterViban], [slaveViban]);

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.getFrickVirtualIbansForAccount).toHaveBeenCalledWith(master.id, mergeManager);
      expect(virtualIbanService.getFrickVirtualIbansForAccount).toHaveBeenCalledWith(slave.id, mergeManager);
      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(master.virtualIbans).toBeUndefined();
      expect(slaveViban.userData).toBe(slave);
      expect(slaveViban.active).toBe(true);
      expect(slaveViban.status).toBe(VirtualIbanStatus.ACTIVE);
    });

    it('deactivates the higher-id active vIBAN when master and slave share currency+bank', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      // lower id wins (matches findActiveForUserCurrencyAndBank order: { id: 'ASC' })
      const masterViban = buildActiveViban(11, master, eur, frick);
      const slaveViban = buildActiveViban(22, slave, eur, frick);

      await prepareMerge(master, slave, [masterViban], [slaveViban]);

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledTimes(1);
      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(
        master.id,
        slave.id,
        [
          {
            virtualIban: slaveViban,
            reason: expect.stringContaining(`Merged into virtual IBAN ${masterViban.id}`),
          },
        ],
        mergeManager,
      );
      const deactivations = virtualIbanService.mergeUserLevelVirtualIbans.mock.calls[0][2];
      expect(deactivations[0].reason).toEqual(expect.stringMatching(/master 1000.*slave 2000|slave 2000.*master 1000/));
      expect(deactivations[0].reason).toContain(String(slaveViban.id));
      expect(masterViban.active).toBe(true);
      expect(masterViban.status).toBe(VirtualIbanStatus.ACTIVE);
      expect(slaveViban.active).toBe(false);
      expect(slaveViban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(slaveViban.deactivatedAt).toBeInstanceOf(Date);

      const saved = userDataRepo.save.mock.calls[0][0] as UserData;
      expect(saved.virtualIbans).toBeUndefined();
    });

    it('keeps both active when master and slave have different currency+bank pairs', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const masterViban = buildActiveViban(11, master, eur, frick);
      const slaveViban = buildActiveViban(22, slave, chf, yapeal);

      await prepareMerge(master, slave, [masterViban], [slaveViban]);

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(masterViban.active).toBe(true);
      expect(slaveViban.active).toBe(true);
      expect(master.virtualIbans).toBeUndefined();
    });

    it('does not deduplicate same-pair Yapeal IBANs during account merge', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const masterViban = buildActiveViban(11, master, chf, yapeal);
      const slaveViban = buildActiveViban(22, slave, chf, yapeal);

      await prepareMerge(master, slave, [masterViban], [slaveViban]);

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(masterViban.active).toBe(true);
      expect(slaveViban.active).toBe(true);
      expect(masterViban.userData).toBe(master);
      expect(slaveViban.userData).toBe(slave);
    });

    it('reassigns slave issuance intent to master when master has none for that currency+bank', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slave.id,
        currencyId: eur.id,
        bankId: frick.id,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
      });

      await prepareMerge(master, slave, [], []);
      // Exercise the merge hook; production reassignment is implemented in VirtualIbanService
      // (see resolveIssuanceIntentsForMerge unit tests). Mock applies the same ownership flip here.
      virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async (masterId, slaveId) => {
        expect(slaveId).toBe(slave.id);
        expect(masterId).toBe(master.id);
        slaveIntent.userDataId = masterId;
      });

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(slaveIntent.userDataId).toBe(master.id);
    });

    it('fails PENDING slave issuance intent when master already has the same currency+bank pair', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: master.id,
        currencyId: eur.id,
        bankId: frick.id,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
      });
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slave.id,
        currencyId: eur.id,
        bankId: frick.id,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
      });

      await prepareMerge(master, slave, [], []);
      virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async (masterId, slaveId) => {
        // Unique index blocks reassignment — fail non-terminal slave intent, leave master's alone.
        slaveIntent.status = VirtualIbanIssuanceIntentStatus.FAILED;
        slaveIntent.error = `Superseded by account merge of userData ${slaveId} into ${masterId}; merge-superseded; previousRequestReference=dfx-viban-placeholder`;
      });

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(masterIntent.userDataId).toBe(master.id);
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntent.error).toContain('Superseded by account merge');
      expect(slaveIntent.error).toContain(String(master.id));
      expect(slaveIntent.error).toContain(String(slave.id));
      expect(slaveIntent.userDataId).toBe(slave.id);
    });

    it('leaves COMPLETED slave issuance intent untouched during merge', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slave.id,
        currencyId: eur.id,
        bankId: frick.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: 'LI21088110100111K000E',
      });

      await prepareMerge(master, slave, [], []);
      virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async () => {
        // COMPLETED is historical — no status change, no reassignment.
      });

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(master.id, slave.id, [], mergeManager);
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(slaveIntent.userDataId).toBe(slave.id);
      expect(slaveIntent.externalIban).toBe('LI21088110100111K000E');
    });

    it('leaves buy-scoped vIBANs untouched even when they share currency+bank with another active vIBAN', async () => {
      const master = buildAccount(1000, 50);
      const slave = buildAccount(2000, 20);
      const buyA = { id: 501 };
      const buyB = { id: 502 };
      // User-level conflict (buy null) between master/slave for EUR+Frick — only that is deduped.
      const masterUserLevel = buildActiveViban(11, master, eur, frick, null, 'LI21088110100111K011E');
      const slaveUserLevel = buildActiveViban(22, slave, eur, frick, null, 'LI21088110100111K022E');
      // Buy-scoped rows share the same currency+bank but must survive (one personal IBAN per Buy route).
      const masterBuyScoped = buildActiveViban(12, master, eur, frick, buyA, 'LI21088110100111K012E');
      const slaveBuyScoped = buildActiveViban(13, slave, eur, frick, buyB, 'LI21088110100111K013E');

      await prepareMerge(master, slave, [masterUserLevel, masterBuyScoped], [slaveUserLevel, slaveBuyScoped]);

      await service.mergeUserData(master.id, slave.id);

      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledTimes(1);
      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(
        master.id,
        slave.id,
        [
          {
            virtualIban: slaveUserLevel,
            reason: expect.stringContaining(`Merged into virtual IBAN ${masterUserLevel.id}`),
          },
        ],
        mergeManager,
      );
      expect(masterUserLevel.active).toBe(true);
      expect(slaveUserLevel.active).toBe(false);
      expect(masterBuyScoped.active).toBe(true);
      expect(masterBuyScoped.status).toBe(VirtualIbanStatus.ACTIVE);
      expect(slaveBuyScoped.active).toBe(true);
      expect(slaveBuyScoped.status).toBe(VirtualIbanStatus.ACTIVE);
      const deactivations = virtualIbanService.mergeUserLevelVirtualIbans.mock.calls[0][2];
      expect(deactivations.map((d) => d.virtualIban)).not.toContain(masterBuyScoped);
      expect(deactivations.map((d) => d.virtualIban)).not.toContain(slaveBuyScoped);
    });

    it.each([
      {
        label: 'master wins by lower id',
        masterVibanId: 11,
        slaveVibanId: 22,
        winnerSide: 'master' as const,
      },
      {
        label: 'slave wins by lower id',
        masterVibanId: 30,
        slaveVibanId: 20,
        winnerSide: 'slave' as const,
      },
    ])(
      'Frick user-level conflict ($label): one active vIBAN and no Completed intent points at a deactivated IBAN',
      async ({ masterVibanId, slaveVibanId, winnerSide }) => {
        const master = buildAccount(1000, 50);
        const slave = buildAccount(2000, 20);
        const masterViban = buildActiveViban(masterVibanId, master, eur, frick, null, 'LI21088110100111K0MAE');
        const slaveViban = buildActiveViban(slaveVibanId, slave, eur, frick, null, 'LI21088110100111K0SLE');
        const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 500,
          userDataId: master.id,
          currencyId: eur.id,
          bankId: frick.id,
          status: VirtualIbanIssuanceIntentStatus.COMPLETED,
          externalIban: masterViban.iban,
          requestReference: 'dfx-viban-master-completed',
          error: null,
        });
        const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 501,
          userDataId: slave.id,
          currencyId: eur.id,
          bankId: frick.id,
          status: VirtualIbanIssuanceIntentStatus.COMPLETED,
          externalIban: slaveViban.iban,
          requestReference: 'dfx-viban-slave-completed',
          error: null,
        });

        await prepareMerge(master, slave, [masterViban], [slaveViban]);

        // Simulate fixed atomic mergeUserLevelVirtualIbans: deactivate loser (reset matching
        // Completed intent to Pending), reassign winner ownership onto master, permanently
        // merge-fail the loser-side intent (whichever account that is — never leave it Pending/
        // reopenable), and reassign the winner-side Completed intent onto masterId. Unique index
        // (userDataId, currencyId, bankId) forces a park-swap when the failed loser still occupies
        // the master slot: the failed row relocates onto the winner's previous owner.
        virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(async (masterId, slaveId, deactivations) => {
          for (const { virtualIban } of deactivations) {
            virtualIban.active = false;
            virtualIban.status = VirtualIbanStatus.DEACTIVATED;
            virtualIban.deactivatedAt = new Date();
            for (const intent of [masterIntent, slaveIntent]) {
              if (
                intent.userDataId === virtualIban.userData.id &&
                intent.currencyId === virtualIban.currency.id &&
                intent.bankId === virtualIban.bank.id &&
                intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED &&
                intent.externalIban === virtualIban.iban
              ) {
                intent.status = VirtualIbanIssuanceIntentStatus.PENDING;
                intent.externalIban = null;
                intent.requestReference = `dfx-viban-reset-${intent.id}`;
              }
            }
          }

          const winnerViban = winnerSide === 'master' ? masterViban : slaveViban;
          const winnerIntent = winnerSide === 'master' ? masterIntent : slaveIntent;
          const loserIntent = winnerSide === 'master' ? slaveIntent : masterIntent;

          if (winnerViban.userData.id !== masterId) {
            winnerViban.userData = { id: masterId } as UserData;
          }

          if (
            loserIntent.status === VirtualIbanIssuanceIntentStatus.PENDING ||
            loserIntent.status === VirtualIbanIssuanceIntentStatus.IN_FLIGHT
          ) {
            loserIntent.status = VirtualIbanIssuanceIntentStatus.FAILED;
            loserIntent.error =
              `Superseded by account merge of userData ${slaveId} into ${masterId}; ${MERGE_SUPERSEDED_MARKER}; ` +
              `previousRequestReference=${loserIntent.requestReference}`;
          }

          if (winnerIntent.userDataId !== masterId) {
            // Free masterId slot when the merge-failed loser still occupies it.
            if (loserIntent.userDataId === masterId && loserIntent.id !== winnerIntent.id) {
              loserIntent.userDataId = winnerIntent.userDataId;
            }
            winnerIntent.userDataId = masterId;
          }
        });

        await service.mergeUserData(master.id, slave.id);

        const winner = winnerSide === 'master' ? masterViban : slaveViban;
        const loser = winnerSide === 'master' ? slaveViban : masterViban;
        const winnerIntent = winnerSide === 'master' ? masterIntent : slaveIntent;
        const loserIntent = winnerSide === 'master' ? slaveIntent : masterIntent;

        expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledTimes(1);
        expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(
          master.id,
          slave.id,
          [
            {
              virtualIban: loser,
              reason: expect.stringContaining(`Merged into virtual IBAN ${winner.id}`),
            },
          ],
          mergeManager,
        );
        expect(winner.active).toBe(true);
        expect(winner.status).toBe(VirtualIbanStatus.ACTIVE);
        expect(loser.active).toBe(false);
        expect(loser.status).toBe(VirtualIbanStatus.DEACTIVATED);

        // Loser's intent must not remain Completed pointing at the dead IBAN.
        expect(loserIntent.externalIban).not.toBe(loser.iban);
        expect(loserIntent.status).not.toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);

        // Loser-side intent is always permanently merge-terminated in the same transaction,
        // never left Pending/reopenable. Winner-side stays Completed under masterId.
        if (winnerSide === 'slave') {
          expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
          expect(masterIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
          // Unique-index park-swap relocates the failed loser onto the retired slave id so the
          // Completed winner can occupy masterId.
          expect(masterIntent.userDataId).toBe(slave.id);
          expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
          expect(slaveIntent.userDataId).toBe(master.id);
          expect(slaveIntent.externalIban).toBe(slaveViban.iban);
        } else {
          expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
          expect(masterIntent.externalIban).toBe(masterViban.iban);
          expect(masterIntent.userDataId).toBe(master.id);
          expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
          expect(slaveIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
          expect(slaveIntent.userDataId).toBe(slave.id);
        }

        // No Completed intent still points at a deactivated IBAN.
        for (const intent of [masterIntent, slaveIntent]) {
          if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) {
            expect(intent.externalIban).not.toBe(loser.iban);
            expect([winner.iban]).toContain(intent.externalIban);
          }
        }

        expect(winnerIntent.userDataId).toBe(master.id);
      },
    );
  });

  describe('mergeUserData transaction boundary', () => {
    it('rolls back persisted merge state after a late database failure and emits no post-commit effects', async () => {
      const masterId = 1000;
      const slaveId = 2000;
      type PersistedMergeState = {
        masterStatus: UserDataStatus;
        slaveStatus: UserDataStatus;
        virtualIbanOwnerId: number;
        lifecycleEventCount: number;
      };
      const persisted: PersistedMergeState = {
        masterStatus: UserDataStatus.ACTIVE,
        slaveStatus: UserDataStatus.ACTIVE,
        virtualIbanOwnerId: slaveId,
        lifecycleEventCount: 0,
      };
      let working = { ...persisted };

      const buildAccount = (id: number, status: UserDataStatus): UserData =>
        Object.assign(new UserData(), {
          id,
          kycLevel: id === masterId ? 50 : 20,
          kycType: KycType.DFX,
          status,
          mail: `${id}@example.com`,
          users: [],
          accountRelations: [],
          relatedAccountRelations: [],
          supportIssues: [],
        });
      const findAccount = (state: PersistedMergeState, id: number): UserData =>
        buildAccount(id, id === masterId ? state.masterStatus : state.slaveStatus);

      const txUserDataRepo = {
        findOne: jest.fn().mockImplementation(async ({ where: { id } }) => findAccount(working, id)),
        update: jest.fn().mockImplementation(async (id: number, update: Partial<UserData>) => {
          if (id === slaveId && update.status) working.slaveStatus = update.status;
        }),
        save: jest.fn().mockImplementation(async (entity: UserData) => entity),
      };
      const txUserRepo = { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
      (mergeManager.getRepository as jest.Mock).mockImplementation((entity) => {
        if (entity === UserData) return txUserDataRepo;
        return txUserRepo;
      });
      (mergeManager.transaction as jest.Mock).mockImplementation(
        async (run: (manager: EntityManager) => Promise<unknown>) => {
          working = { ...persisted };
          try {
            const result = await run(mergeManager);
            Object.assign(persisted, working);
            return result;
          } catch (error) {
            working = { ...persisted };
            throw error;
          }
        },
      );

      // These injected-repository implementations deliberately mutate committed state. If merge
      // code escapes the transaction manager, the rollback assertion below exposes the leak.
      userDataRepo.findOne.mockImplementation(async ({ where }) => {
        const id = (where as FindOptionsWhere<UserData>).id as number;
        return findAccount(persisted, id);
      });
      userDataRepo.update.mockImplementation(async (criteria, partialEntity) => {
        const update = partialEntity as Partial<UserData>;
        if (criteria === slaveId && update.status) persisted.slaveStatus = update.status;
        return { affected: 1, raw: [], generatedMaps: [] };
      });
      userDataRepo.save.mockImplementation(async (entity: UserData) => entity);

      transactionService.getAllTransactionsForUserData.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);
      bankDataService.getAllBankDatasForUser.mockResolvedValue([]);
      kycAdminService.getKycSteps.mockResolvedValue([]);
      virtualIbanService.getFrickVirtualIbansForAccount.mockImplementation(async (id: number) =>
        id === slaveId
          ? [
              Object.assign(new VirtualIban(), {
                id: 77,
                active: true,
                status: VirtualIbanStatus.ACTIVE,
                buy: null,
                userData: { id: working.virtualIbanOwnerId },
                currency: { id: 1 },
                bank: { id: 10 },
              }),
            ]
          : [],
      );
      virtualIbanService.mergeUserLevelVirtualIbans.mockImplementation(
        async (_masterId, _slaveId, _deactivations, manager) => {
          const target = manager === mergeManager ? working : persisted;
          target.virtualIbanOwnerId = masterId;
          target.lifecycleEventCount++;
        },
      );
      virtualIbanService.lockUserLevelIssuanceForMerge.mockResolvedValue(undefined);
      jest.spyOn(service, 'updateVolumes').mockResolvedValue(undefined);
      jest
        .spyOn(service as unknown as { updateBankTxTime: () => Promise<void> }, 'updateBankTxTime')
        .mockResolvedValue(undefined);
      kycLogService.createMergeLog.mockRejectedValueOnce(new Error('late merge log write failed'));

      await expect(service.mergeUserData(masterId, slaveId, undefined, true)).rejects.toThrow(
        'late merge log write failed',
      );

      expect(persisted).toEqual({
        masterStatus: UserDataStatus.ACTIVE,
        slaveStatus: UserDataStatus.ACTIVE,
        virtualIbanOwnerId: slaveId,
        lifecycleEventCount: 0,
      });
      expect(userDataRepo.findOne).not.toHaveBeenCalled();
      expect(userDataRepo.update).not.toHaveBeenCalled();
      expect(userDataRepo.save).not.toHaveBeenCalled();
      expect(transactionService.getAllTransactionsForUserData).toHaveBeenCalledWith(masterId, {}, mergeManager);
      expect(transactionService.getAllTransactionsForUserData).toHaveBeenCalledWith(slaveId, {}, mergeManager);
      expect(bankDataService.getAllBankDatasForUser).toHaveBeenCalledWith(masterId, mergeManager);
      expect(bankDataService.getAllBankDatasForUser).toHaveBeenCalledWith(slaveId, mergeManager);
      expect(kycAdminService.getKycSteps).toHaveBeenCalledWith(masterId, {}, mergeManager);
      expect(kycAdminService.getKycSteps).toHaveBeenCalledWith(slaveId, {}, mergeManager);
      expect(virtualIbanService.getFrickVirtualIbansForAccount).toHaveBeenCalledWith(masterId, mergeManager);
      expect(virtualIbanService.getFrickVirtualIbansForAccount).toHaveBeenCalledWith(slaveId, mergeManager);
      expect(virtualIbanService.mergeUserLevelVirtualIbans).toHaveBeenCalledWith(masterId, slaveId, [], mergeManager);
      expect(kycLogService.createMergeLog).toHaveBeenCalledWith(
        expect.objectContaining({ id: masterId }),
        expect.any(String),
        mergeManager,
      );
      expect(documentService.copyFiles).not.toHaveBeenCalled();
      expect(webhookService.accountChangedStrict).not.toHaveBeenCalled();
      expect(kycNotificationService.kycChanged).not.toHaveBeenCalled();
      expect(userDataNotificationService.userDataChangedMailInfo).not.toHaveBeenCalled();
      expect(userDataNotificationService.userDataAddedAddressInfo).not.toHaveBeenCalled();
    });

    it('records a failed post-commit effect, attempts the rest, and still reports the committed merge as complete', async () => {
      const master = Object.assign(new UserData(), {
        id: 1000,
        kycLevel: 50,
        kycType: KycType.DFX,
        status: UserDataStatus.ACTIVE,
        mail: 'master@example.com',
        users: [],
        accountRelations: [],
        relatedAccountRelations: [],
        supportIssues: [],
      });
      const slave = Object.assign(new UserData(), {
        id: 2000,
        kycLevel: 20,
        kycType: KycType.DFX,
        status: UserDataStatus.ACTIVE,
        mail: 'slave@example.com',
        firstname: 'Sensitive Slave Name',
        users: [],
        accountRelations: [],
        relatedAccountRelations: [],
        supportIssues: [],
      });
      userDataRepo.findOne.mockResolvedValueOnce(master).mockResolvedValueOnce(slave);
      transactionService.getAllTransactionsForUserData.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);
      bankDataService.getAllBankDatasForUser.mockResolvedValue([]);
      virtualIbanService.getFrickVirtualIbansForAccount.mockResolvedValue([]);
      kycAdminService.getKycSteps.mockResolvedValue([]);
      documentService.copyFiles.mockRejectedValue(new Error('storage unavailable'));
      webhookService.accountChangedStrict.mockRejectedValue(new Error('account webhook unavailable'));
      kycNotificationService.kycChangedStrict.mockRejectedValue(new Error('KYC webhook unavailable'));
      userDataNotificationService.userDataChangedMailInfoStrict.mockRejectedValue(new Error('mail unavailable'));
      userDataNotificationService.userDataAddedAddressInfoStrict.mockResolvedValue(undefined);
      jest.spyOn(service, 'updateVolumes').mockResolvedValue(undefined);
      jest
        .spyOn(service as unknown as { updateBankTxTime: () => Promise<void> }, 'updateBankTxTime')
        .mockResolvedValue(undefined);
      const executionOrder: string[] = [];
      (mergeManager.transaction as jest.Mock).mockImplementation(
        async (run: (manager: EntityManager) => Promise<unknown>) => {
          const result = await run(mergeManager);
          executionOrder.push('commit');
          return result;
        },
      );
      kycLogService.createMergeLog.mockImplementation(async (_user, log) => {
        expect(log).toContain(MERGE_POST_COMMIT_EFFECTS_PENDING_MARKER);
        executionOrder.push('durable marker');
      });
      documentService.copyFiles.mockImplementation(async () => {
        executionOrder.push('post-commit effect');
        throw new Error('storage unavailable');
      });
      const infoSpy = jest.spyOn((service as any).logger, 'info').mockImplementation(() => undefined);
      const criticalSpy = jest.spyOn((service as any).logger, 'critical').mockImplementation(() => undefined);

      await expect(service.mergeUserData(master.id, slave.id, undefined, true)).resolves.toBeUndefined();

      expect(webhookService.accountChangedStrict).toHaveBeenCalledWith(master, slave);
      expect(kycNotificationService.kycChangedStrict).toHaveBeenCalledWith(master);
      expect(userDataNotificationService.userDataChangedMailInfoStrict).toHaveBeenCalledWith(
        expect.objectContaining({ id: master.id, mail: 'master@example.com' }),
        slave,
      );
      expect(userDataNotificationService.userDataAddedAddressInfoStrict).toHaveBeenCalledWith(master, slave);
      expect(criticalSpy).toHaveBeenCalledWith(
        expect.stringContaining(`masterId=${master.id}, slaveId=${slave.id}, effect=document copy`),
        expect.any(Error),
      );
      expect(criticalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `UserData merge completed with failed post-commit effects (masterId=${master.id}, ` +
            `slaveId=${slave.id}, failedEffects=changed-mail notification,document copy,` +
            `account-changed webhook,KYC-changed notification)`,
        ),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('UserData merge committed; starting post-commit effects'),
      );
      expect(kycLogService.createMergeLog).toHaveBeenCalledTimes(2);
      expect(kycLogService.createMergeEffectMarkerLogs).toHaveBeenCalledTimes(5);
      expect(kycLogService.createMergeEffectMarkerLogs).toHaveBeenCalledWith(
        master,
        slave,
        `masterId=${master.id}; slaveId=${slave.id}; ` +
          `${MERGE_POST_COMMIT_EFFECT_COMPLETED_MARKER}added-address notification`,
      );
      const markerLogs = kycLogService.createMergeEffectMarkerLogs.mock.calls.map((call) => call[2]);
      for (const effect of [
        'changed-mail notification',
        'document copy',
        'account-changed webhook',
        'KYC-changed notification',
      ]) {
        expect(markerLogs).toContain(
          `masterId=${master.id}; slaveId=${slave.id}; ${MERGE_POST_COMMIT_EFFECT_FAILED_MARKER}${effect}`,
        );
      }
      const completionLogs = markerLogs.filter((log) => log.includes(MERGE_POST_COMMIT_EFFECT_COMPLETED_MARKER));
      for (const effect of [
        'changed-mail notification',
        'document copy',
        'account-changed webhook',
        'KYC-changed notification',
      ]) {
        expect(completionLogs.join('\n')).not.toContain(`${MERGE_POST_COMMIT_EFFECT_COMPLETED_MARKER}${effect}`);
      }
      expect(markerLogs.join('\n')).not.toContain(master.mail);
      expect(markerLogs.join('\n')).not.toContain(slave.mail);
      expect(markerLogs.join('\n')).not.toContain(slave.firstname);
      expect(kycLogService.createMergeLog).toHaveBeenCalledWith(
        master,
        expect.stringContaining(
          `${MERGE_POST_COMMIT_EFFECTS_PENDING_MARKER}changed-mail notification,document copy,` +
            'account-changed webhook,KYC-changed notification,added-address notification',
        ),
        mergeManager,
      );
      expect(executionOrder).toEqual(['durable marker', 'durable marker', 'commit', 'post-commit effect']);
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

  describe('setKycStatusCheck', () => {
    it('writes the audit log before conditionally updating the status', async () => {
      const userData = Object.assign(new UserData(), { id: 42, kycStatus: KycStatus.COMPLETED });
      (mergeManager.findOne as jest.Mock).mockResolvedValue(userData);
      (mergeManager.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.setKycStatusCheck(42, KycStatus.COMPLETED, 7);

      expect(kycLogService.createLogInternal).toHaveBeenCalledWith(
        userData,
        KycLogType.MANUAL,
        'KycStatus changed from Completed to Check by user data 7',
        mergeManager,
      );
      expect(mergeManager.update).toHaveBeenCalledWith(
        UserData,
        { id: 42, kycStatus: KycStatus.COMPLETED },
        { kycStatus: KycStatus.CHECK },
      );
      expect(kycLogService.createLogInternal.mock.invocationCallOrder[0]).toBeLessThan(
        (mergeManager.update as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(kycNotificationService.kycChanged).toHaveBeenCalledWith(userData);
      expect((mergeManager.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        kycNotificationService.kycChanged.mock.invocationCallOrder[0],
      );
    });

    it('does not update the status when the audit log fails', async () => {
      const userData = Object.assign(new UserData(), { id: 42, kycStatus: KycStatus.COMPLETED });
      (mergeManager.findOne as jest.Mock).mockResolvedValue(userData);
      kycLogService.createLogInternal.mockRejectedValue(new Error('Audit unavailable'));

      await expect(service.setKycStatusCheck(42, KycStatus.COMPLETED, 7)).rejects.toThrow('Audit unavailable');

      expect(mergeManager.update).not.toHaveBeenCalled();
    });

    it('rejects a stale expected status before writing an audit log', async () => {
      const userData = Object.assign(new UserData(), { id: 42, kycStatus: KycStatus.REJECTED });
      (mergeManager.findOne as jest.Mock).mockResolvedValue(userData);

      await expect(service.setKycStatusCheck(42, KycStatus.COMPLETED, 7)).rejects.toBeInstanceOf(ConflictException);

      expect(kycLogService.createLogInternal).not.toHaveBeenCalled();
      expect(mergeManager.update).not.toHaveBeenCalled();
    });

    it('rolls back the audit log when a concurrent update wins the conditional write', async () => {
      const userData = Object.assign(new UserData(), { id: 42, kycStatus: KycStatus.COMPLETED });
      (mergeManager.findOne as jest.Mock).mockResolvedValue(userData);
      (mergeManager.update as jest.Mock).mockResolvedValue({ affected: 0 });

      await expect(service.setKycStatusCheck(42, KycStatus.COMPLETED, 7)).rejects.toBeInstanceOf(ConflictException);

      expect(kycLogService.createLogInternal).toHaveBeenCalledTimes(1);
      expect(kycNotificationService.kycChanged).not.toHaveBeenCalled();
    });
  });

  it('rejects setting Check through the generic update path before reading the account', async () => {
    await expect(service.updateUserData(42, { kycStatus: KycStatus.CHECK })).rejects.toThrow(
      'Use the audited KYC status Check transition',
    );

    expect(userDataRepo.findOne).not.toHaveBeenCalled();
  });
});
