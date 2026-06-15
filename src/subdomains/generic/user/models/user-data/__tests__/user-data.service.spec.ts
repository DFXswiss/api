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
import { UserData } from '../user-data.entity';
import { UserDataRepository } from '../user-data.repository';
import { UserDataService } from '../user-data.service';
import { UserRepository } from '../../user/user.repository';

describe('UserDataService', () => {
  let service: UserDataService;
  let userDataRepo: jest.Mocked<UserDataRepository>;

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
