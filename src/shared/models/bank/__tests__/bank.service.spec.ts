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
import {
  createDefaultBanks,
  createDefaultDisabledBanks,
  frickCHF,
  frickEUR,
  frickUSD,
  maerkiCHF,
  maerkiEUR,
  olkyEUR,
} from '../__mocks__/bank.entity.mock';

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

  function defaultSetup(maerkiBaumannEnable = true, disabledBank = false) {
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: maerkiBaumannEnable }));
    jest.spyOn(bankRepo, 'find').mockResolvedValue(disabledBank ? createDefaultDisabledBanks() : createDefaultBanks());
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return BF if amount > 9000', async () => {
    defaultSetup();
    await expect(service.getBank(createBankSelectorInput('CHF', 10000))).resolves.toMatchObject({
      iban: frickCHF.iban,
      bic: frickCHF.bic,
    });
  });

  it('should return BF if currency = USD', async () => {
    defaultSetup();
    await expect(service.getBank(createBankSelectorInput('USD'))).resolves.toMatchObject({
      iban: frickUSD.iban,
      bic: frickUSD.bic,
    });
  });

  it('should return Olkypay if currency = EUR & sctInst & KYC completed', async () => {
    defaultSetup();
    await expect(service.getBank(createBankSelectorInput('EUR'))).resolves.toMatchObject({
      iban: olkyEUR.iban,
      bic: olkyEUR.bic,
    });
  });

  it('should return MB if ibanCountry = MBCountry & userDataCountry = MBCountry', async () => {
    defaultSetup(true);
    await expect(service.getBank(createBankSelectorInput('CHF'))).resolves.toMatchObject({
      iban: maerkiCHF.iban,
      bic: maerkiCHF.bic,
    });
  });

  it('should return BF as default', async () => {
    defaultSetup(false);
    await expect(service.getBank(createBankSelectorInput('GBP'))).resolves.toMatchObject({
      iban: frickEUR.iban,
      bic: frickEUR.bic,
    });
  });

  it('should return maerki if currency = EUR & sctInst & KYC completed & olky disabled', async () => {
    defaultSetup(true, true);
    await expect(service.getBank(createBankSelectorInput('EUR'))).resolves.toMatchObject({
      iban: maerkiEUR.iban,
      bic: maerkiEUR.bic,
    });
  });
});
