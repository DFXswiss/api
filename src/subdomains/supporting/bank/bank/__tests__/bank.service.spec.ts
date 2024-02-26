import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { createDefaultBankAccount } from 'src/subdomains/supporting/bank/bank-account/__mocks__/bank-account.entity.mock';
import { BankAccount } from 'src/subdomains/supporting/bank/bank-account/bank-account.entity';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  createDefaultBanks,
  createDefaultDisabledBanks,
  frickCHF,
  frickUSD,
  maerkiCHF,
  maerkiEUR,
  olkyEUR,
} from '../__mocks__/bank.entity.mock';
import { BankRepository } from '../bank.repository';
import { BankSelectorInput, BankService } from '../bank.service';

function createBankSelectorInput(
  currency = 'EUR',
  amount = 1,
  bankAccount: BankAccount = createDefaultBankAccount(),
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK,
  userData: UserData = createDefaultUserData(),
): BankSelectorInput {
  return {
    bankAccount,
    amount,
    currency,
    paymentMethod,
    userData,
  };
}

describe('BankService', () => {
  let service: BankService;

  let bankRepo: BankRepository;
  let userService: UserService;
  let buyCryptoService: BuyCryptoService;
  let fiatService: FiatService;
  let countryService: CountryService;
  let bankAccountService: BankAccountService;

  beforeEach(async () => {
    bankRepo = createMock<BankRepository>();
    userService = createMock<UserService>();
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

  it('should return Olkypay if currency = EUR & sctInst & Method instant', async () => {
    defaultSetup();
    await expect(
      service.getBank(createBankSelectorInput('EUR', undefined, undefined, FiatPaymentMethod.INSTANT)),
    ).resolves.toMatchObject({
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

  it('should return MB as default', async () => {
    defaultSetup(false);
    await expect(service.getBank(createBankSelectorInput('GBP'))).resolves.toMatchObject({
      iban: maerkiEUR.iban,
      bic: maerkiEUR.bic,
    });
  });

  it('should return maerki if currency = EUR & sctInst & Method instant & olky disabled', async () => {
    defaultSetup(true, true);
    await expect(
      service.getBank(createBankSelectorInput('EUR', undefined, undefined, FiatPaymentMethod.INSTANT)),
    ).resolves.toMatchObject({
      iban: maerkiEUR.iban,
      bic: maerkiEUR.bic,
    });
  });
});
