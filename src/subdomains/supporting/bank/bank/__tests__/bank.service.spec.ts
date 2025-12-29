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
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  createDefaultBanks,
  createDefaultDisabledBanks,
  maerkiCHF,
  maerkiEUR,
  olkyEUR,
} from '../__mocks__/bank.entity.mock';
import { BankRepository } from '../bank.repository';
import { BankSelectorInput, BankService } from '../bank.service';

function createBankSelectorInput(
  currency = 'EUR',
  amount = 1,
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK,
  userData: UserData = createDefaultUserData(),
): BankSelectorInput {
  return {
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

    const allBanks = disabledBank ? createDefaultDisabledBanks() : createDefaultBanks();
    jest
      .spyOn(bankRepo, 'findCachedBy')
      .mockImplementation(async (_key: string, filter?: any) => {
        if (filter?.receive !== undefined) {
          return allBanks.filter(b => b.receive === filter.receive);
        }
        return allBanks;
      });
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return first matching bank for CHF currency', async () => {
    defaultSetup();
    const result = await service.getBank(createBankSelectorInput('CHF', 10000));
    expect(result.iban).toBe(maerkiCHF.iban);
    expect(result.bic).toBe(maerkiCHF.bic);
  });

  it('should return matching bank for EUR currency', async () => {
    defaultSetup();
    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result.iban).toBe(maerkiEUR.iban);
    expect(result.bic).toBe(maerkiEUR.bic);
  });

  it('should return sctInst bank for instant payment', async () => {
    defaultSetup();
    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result.iban).toBe(olkyEUR.iban);
    expect(result.bic).toBe(olkyEUR.bic);
  });

  it('should return first matching bank for CHF currency with standard payment', async () => {
    defaultSetup(true);
    const result = await service.getBank(createBankSelectorInput('CHF'));
    expect(result.iban).toBe(maerkiCHF.iban);
    expect(result.bic).toBe(maerkiCHF.bic);
  });

  it('should fallback to EUR for unsupported currency', async () => {
    defaultSetup(false);
    const result = await service.getBank(createBankSelectorInput('GBP'));
    expect(result.iban).toBe(maerkiEUR.iban);
    expect(result.bic).toBe(maerkiEUR.bic);
  });

  it('should fallback to first EUR bank when sctInst bank is disabled', async () => {
    defaultSetup(true, true);
    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result.iban).toBe(maerkiEUR.iban);
    expect(result.bic).toBe(maerkiEUR.bic);
  });
});
