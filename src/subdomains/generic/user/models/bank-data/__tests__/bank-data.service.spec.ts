import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { olkyEUR } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { AccountMergeService } from '../../account-merge/account-merge.service';
import { UserData } from '../../user-data/user-data.entity';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { BankData, BankDataType } from '../bank-data.entity';
import { BankDataRepository } from '../bank-data.repository';
import { BankDataService } from '../bank-data.service';

// A DFX-owned IBAN registered as a user's bankData makes every transfer sent from that DFX account
// look like a customer deposit: getUserDataForBankTx keys on bankTx.senderAccount and the lookup
// behind it ignores `active`. @IsDfxIban only guards the inbound DTOs, so callers that build the DTO
// themselves (support-issue, from a user-supplied senderIban) reached this method unchecked.
// Whether an IBAN counts as DFX-owned is BankService.areKnownBankIbans' contract and is covered in
// its own spec; what matters here is that the guard asks it and acts on the answer.
describe('BankDataService DFX-IBAN guard', () => {
  let service: BankDataService;

  let bankDataRepo: jest.Mocked<BankDataRepository>;
  let bankService: jest.Mocked<BankService>;
  let countryService: jest.Mocked<CountryService>;
  let specialAccountService: jest.Mocked<SpecialExternalAccountService>;

  const dfxIban = olkyEUR.iban;
  const customerIban = 'DE89370400440532013000';

  const userData = () => createMock<UserData>({ status: undefined });

  beforeEach(async () => {
    bankDataRepo = createMock<BankDataRepository>();
    bankService = createMock<BankService>();
    countryService = createMock<CountryService>();
    specialAccountService = createMock<SpecialExternalAccountService>();

    specialAccountService.getMultiAccountIbans.mockResolvedValue([]);
    bankService.areKnownBankIbans.mockResolvedValue(false);
    // everything past the guard: no country restriction, no pre-existing bankData
    countryService.getCountryWithSymbol.mockResolvedValue({ isEnabled: () => true } as any);
    bankDataRepo.find.mockResolvedValue([]);
    bankDataRepo.create.mockImplementation((dto) => dto as any);
    bankDataRepo.saveWithUniqueDefault.mockImplementation(async (b) => b as any);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankDataService,
        { provide: UserDataRepository, useValue: createMock<UserDataRepository>() },
        { provide: BankDataRepository, useValue: bankDataRepo },
        { provide: SpecialExternalAccountService, useValue: specialAccountService },
        { provide: AccountMergeService, useValue: createMock<AccountMergeService>() },
        { provide: NameCheckService, useValue: createMock<NameCheckService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: CountryService, useValue: countryService },
        { provide: BankAccountService, useValue: createMock<BankAccountService>() },
        { provide: BankService, useValue: bankService },
        { provide: KycAdminService, useValue: createMock<KycAdminService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BankDataService>(BankDataService);
  });

  const expectRejected = async (iban: string) => {
    const call = service.createIbanForUserInternal(userData(), { iban });

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow('DFX IBAN not allowed');
  };

  it('rejects an IBAN the bank service reports as DFX-owned', async () => {
    bankService.areKnownBankIbans.mockResolvedValue(true);

    await expectRejected(dfxIban);
    expect(bankService.areKnownBankIbans).toHaveBeenCalledWith(dfxIban);
  });

  it('rejects before any bankData is looked up or persisted', async () => {
    bankService.areKnownBankIbans.mockResolvedValue(true);

    await expectRejected(dfxIban);

    // pins the ordering: the guard has to win before the existing-row lookup, whose activate()
    // branch is how a deactivated row came back to life in the first place
    expect(bankDataRepo.find).not.toHaveBeenCalled();
    expect(bankDataRepo.create).not.toHaveBeenCalled();
    expect(bankDataRepo.saveWithUniqueDefault).not.toHaveBeenCalled();
  });

  it('still accepts a normal customer IBAN', async () => {
    await expect(service.createIbanForUserInternal(userData(), { iban: customerIban })).resolves.toBeDefined();

    expect(bankDataRepo.saveWithUniqueDefault).toHaveBeenCalled();
  });

  // updateUserBankData reads as a way to mint a fresh type=USER row past the guard, via the
  // createBankDataInternal behind its `??`. It is not: that fallback needs the preceding lookup to
  // miss, and the lookup's predicate is satisfied by the row itself, whose ownership is asserted
  // immediately above. This pins the resulting behaviour — no second row — not the predicate.
  it('promotes a non-USER row without creating a second one', async () => {
    const entity = { id: 7, iban: customerIban, type: BankDataType.BANK_IN, userData: { id: 42 } } as BankData;
    bankDataRepo.findOne.mockResolvedValue(entity);

    await service.updateUserBankData(entity.id, 42, {});

    expect(bankDataRepo.create).not.toHaveBeenCalled();
  });
});
