import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { TestUtil } from 'src/shared/test.util';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { createCustomCountry, createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { KycStatus } from 'src/user/models/user-data/user-data.entity';
import { BankSelectorInput, BankService } from '../bank.service';
import { UserService } from 'src/user/models/user/user.service';
import { StakingRepository } from 'src/payment/models/staking/staking.repository';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { BuyCryptoService } from 'src/payment/models/buy-crypto/services/buy-crypto.service';
import { BankAccountService } from 'src/payment/models/bank-account/bank-account.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { BankAccount } from 'src/payment/models/bank-account/bank-account.entity';
import { createDefaultBankAccount } from 'src/payment/models/bank-account/__mocks__/bank-account.entity.mock';
import { BankRepository } from '../bank.repository';
import { createDefaultBanks } from '../__mocks__/bank.entity.mock';

function createBankSelectorInput(
  currency: string = 'EUR',
  amount = 1,
  bankAccount: BankAccount = createDefaultBankAccount(),
  kycStatus: KycStatus = KycStatus.COMPLETED,
): BankSelectorInput {
  return {
    bankAccount: bankAccount,
    amount: amount,
    currency: currency,
    kycStatus: kycStatus,
  };
}

describe('BankService', () => {
  let service: BankService;

  let bankRepo: BankRepository;
  let userService: UserService;
  let stakingRepo: StakingRepository;
  let stakingService: StakingService;
  let buyCryptoService: BuyCryptoService;
  let fiatService: FiatService;
  let countryService: CountryService;
  let bankAccountService: BankAccountService;

  beforeEach(async () => {
    bankRepo = createMock<BankRepository>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();
    buyCryptoService = createMock<BuyCryptoService>();
    fiatService = createMock<FiatService>();
    countryService = createMock<CountryService>();
    bankAccountService = createMock<BankAccountService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankService,
        { provide: BankRepository, useValue: bankRepo },
        { provide: UserService, useValue: userService },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: StakingService, useValue: stakingService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: FiatService, useValue: fiatService },
        { provide: CountryService, useValue: countryService },
        { provide: BankAccountService, useValue: bankAccountService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BankService>(BankService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return BF if amount > 9000', async () => {
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());
    jest.spyOn(bankRepo, 'find').mockResolvedValue(createDefaultBanks());

    await expect(service.getBank(createBankSelectorInput('CHF', 10000))).resolves.toMatchObject({
      iban: 'LI52088110104693K000C',
      bic: 'BFRILI22',
    });
  });

  it('should return BF if currency = USD', async () => {
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());
    jest.spyOn(bankRepo, 'find').mockResolvedValue(createDefaultBanks());

    await expect(service.getBank(createBankSelectorInput('USD'))).resolves.toMatchObject({
      iban: 'LI51088110104693K000U',
      bic: 'BFRILI22',
    });
  });

  it('should return Olkypay if currency = EUR & sctInst & KYC completed', async () => {
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());
    jest.spyOn(bankRepo, 'find').mockResolvedValue(createDefaultBanks());

    await expect(service.getBank(createBankSelectorInput('EUR'))).resolves.toMatchObject({
      iban: 'LU116060002000005040',
      bic: 'OLKILUL1',
    });
  });

  it('should return MB if ibanCountry = MBCountry & userDataCountry = MBCountry', async () => {
    jest.spyOn(bankRepo, 'find').mockResolvedValue(createDefaultBanks());
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: true }));

    await expect(service.getBank(createBankSelectorInput('CHF'))).resolves.toMatchObject({
      iban: 'CH3408573177975200001',
      bic: 'MAEBCHZZ',
    });
  });

  it('should return BF as default', async () => {
    jest.spyOn(bankRepo, 'find').mockResolvedValue(createDefaultBanks());
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: false }));

    await expect(service.getBank(createBankSelectorInput('GBP'))).resolves.toMatchObject({
      iban: 'LI95088110104693K000E',
      bic: 'BFRILI22',
    });
  });
});
