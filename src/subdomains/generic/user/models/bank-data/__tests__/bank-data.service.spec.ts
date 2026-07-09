import { ConfigService } from 'src/config/config';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { AccountMergeService } from '../../account-merge/account-merge.service';
import { UserData } from '../../user-data/user-data.entity';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { BankData, BankDataType, BankDataVerificationError } from '../bank-data.entity';
import { BankDataRepository } from '../bank-data.repository';
import { BankDataService } from '../bank-data.service';
import { CreateBankDataDto } from '../dto/create-bank-data.dto';

describe('BankDataService', () => {
  let service: BankDataService;

  let bankDataRepo: jest.Mocked<Partial<BankDataRepository>>;
  let bankAccountService: jest.Mocked<Partial<BankAccountService>>;
  let kycAdminService: jest.Mocked<Partial<KycAdminService>>;

  const buildUserData = (verifiedName?: string): UserData =>
    Object.assign(new UserData(), { id: 1, verifiedName, kycSteps: [] });

  const buildBankOut = (userData: UserData): BankData =>
    Object.assign(new BankData(), {
      id: 10,
      iban: 'AT634477014807580000',
      type: BankDataType.BANK_OUT,
      name: userData.verifiedName,
      approved: true,
      status: ReviewStatus.COMPLETED,
      comment: null,
      userData,
    });

  const buildBankInDto = (name: string): CreateBankDataDto => ({
    type: BankDataType.BANK_IN,
    iban: 'AT634477014807580000',
    name,
  });

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    bankDataRepo = {
      existsBy: jest.fn().mockResolvedValue(false),
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn().mockImplementation((dto) => Object.assign(new BankData(), dto)),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    bankAccountService = {
      getOrCreateIbanBankAccountInternal: jest.fn().mockResolvedValue({ bankName: 'Test Bank' }),
    };
    kycAdminService = { getKycSteps: jest.fn().mockResolvedValue([]) };

    service = new BankDataService(
      {} as unknown as UserDataRepository,
      bankDataRepo as unknown as BankDataRepository,
      {} as unknown as SpecialExternalAccountService,
      {} as unknown as AccountMergeService,
      {} as unknown as NameCheckService,
      {} as unknown as FiatService,
      {} as unknown as CountryService,
      bankAccountService as unknown as BankAccountService,
      kycAdminService as unknown as KycAdminService,
    );
  });

  describe('replaceBankDataWithNewType', () => {
    it('inherits the approval if the account holder matches the verified name', async () => {
      const userData = buildUserData('Wilhelm Walter Moser');
      const oldBankData = buildBankOut(userData);

      const result = await service.replaceBankDataWithNewType(oldBankData, buildBankInDto('Wilhelm Moser'));

      expect(result.approved).toBe(true);
      expect(result.status).toBe(ReviewStatus.COMPLETED);
      expect(bankDataRepo.update).toHaveBeenCalledWith(oldBankData.id, {
        approved: false,
        status: ReviewStatus.FAILED,
        comment: `null;${BankDataVerificationError.REPLACED}`,
      });
    });

    it('does not inherit the approval and keeps the old bankData if the account holder does not match the verified name', async () => {
      const userData = buildUserData('Wilhelm Walter Moser');
      const oldBankData = buildBankOut(userData);

      const result = await service.replaceBankDataWithNewType(oldBankData, buildBankInDto('Verband LebensRaum'));

      expect(result.approved).toBe(false);
      expect(result.status).toBe(ReviewStatus.INTERNAL_REVIEW);
      expect(bankDataRepo.update).not.toHaveBeenCalled();
    });

    it('does not inherit the approval if the verified name is missing', async () => {
      const userData = buildUserData(undefined);
      const oldBankData = buildBankOut(userData);
      oldBankData.name = 'Wilhelm Walter Moser';

      const result = await service.replaceBankDataWithNewType(oldBankData, buildBankInDto('Wilhelm Walter Moser'));

      expect(result.approved).toBe(false);
      expect(result.status).toBe(ReviewStatus.INTERNAL_REVIEW);
      expect(bankDataRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getVerifiedBankDataWithIban', () => {
    const buildRows = (): BankData[] => {
      const userData = buildUserData('Wilhelm Walter Moser');
      const bankOut = buildBankOut(userData);
      const bankIn = Object.assign(new BankData(), {
        id: 11,
        iban: 'AT634477014807580000',
        type: BankDataType.BANK_IN,
        name: 'Verband LebensRaum',
        approved: false,
        status: ReviewStatus.INTERNAL_REVIEW,
        userData,
      });
      return [bankOut, bankIn];
    };

    it('returns the approved bankData of another type by default', async () => {
      bankDataRepo.find = jest.fn().mockResolvedValue(buildRows());

      const result = await service.getVerifiedBankDataWithIban('AT634477014807580000', 1, BankDataType.BANK_IN);

      expect(result.type).toBe(BankDataType.BANK_OUT);
    });

    it('returns the unapproved bankData of the preferred type in strict mode', async () => {
      bankDataRepo.find = jest.fn().mockResolvedValue(buildRows());

      const result = await service.getVerifiedBankDataWithIban(
        'AT634477014807580000',
        1,
        BankDataType.BANK_IN,
        { userData: true },
        false,
        true,
      );

      expect(result.type).toBe(BankDataType.BANK_IN);
      expect(result.approved).toBe(false);
    });

    it('falls back to the approved bankData in strict mode if no bankData of the preferred type exists', async () => {
      const rows = buildRows().filter((b) => b.type !== BankDataType.BANK_IN);
      bankDataRepo.find = jest.fn().mockResolvedValue(rows);

      const result = await service.getVerifiedBankDataWithIban(
        'AT634477014807580000',
        1,
        BankDataType.BANK_IN,
        { userData: true },
        false,
        true,
      );

      expect(result.type).toBe(BankDataType.BANK_OUT);
    });
  });
});
