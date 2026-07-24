import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
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
  yapealCHF,
  yapealEUR,
  olkyEUR,
  frickEUR,
  frickCHF,
} from '../__mocks__/bank.entity.mock';
import { Bank } from '../bank.entity';
import { BankRepository } from '../bank.repository';
import { BankSelectorInput, BankService } from '../bank.service';
import { IbanBankName } from '../dto/bank.dto';

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

  function defaultSetup(yapealEnable = true, disabledBank = false) {
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ yapealEnable: yapealEnable }));

    const allBanks = disabledBank ? createDefaultDisabledBanks() : createDefaultBanks();
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      if (filter?.receive !== undefined) {
        return allBanks.filter((b) => b.receive === filter.receive);
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
    expect(result.iban).toBe(yapealCHF.iban);
    expect(result.bic).toBe(yapealCHF.bic);
  });

  it('should return matching bank for EUR currency', async () => {
    defaultSetup();
    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result.iban).toBe(olkyEUR.iban);
    expect(result.bic).toBe(olkyEUR.bic);
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
    expect(result.iban).toBe(yapealCHF.iban);
    expect(result.bic).toBe(yapealCHF.bic);
  });

  it('should fallback to EUR for unsupported currency', async () => {
    defaultSetup(false);
    const result = await service.getBank(createBankSelectorInput('GBP'));
    expect(result.iban).toBe(olkyEUR.iban);
    expect(result.bic).toBe(olkyEUR.bic);
  });

  it('should fallback to first EUR bank when sctInst bank is disabled', async () => {
    defaultSetup(true, true);
    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result.iban).toBe(yapealEUR.iban);
    expect(result.bic).toBe(yapealEUR.bic);
  });

  it('never offers Bank Frick as a deposit bank, even when it is the first receive bank for the currency', async () => {
    // Frick is placed first so a missing exclusion guard would wrongly select it; the customer must still
    // be shown the incumbent bank for each currency.
    // A preceding test disables the shared olkyEUR mock in place (createDefaultDisabledBanks mutates it),
    // so restore its natural receive state here to exercise Frick exclusion rather than that leaked state.
    olkyEUR.receive = true;
    const frickFirst = [frickEUR, frickCHF, olkyEUR, yapealEUR, yapealCHF];
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      if (filter?.receive !== undefined) return frickFirst.filter((b) => b.receive === filter.receive);
      return frickFirst;
    });

    const eur = await service.getBank(createBankSelectorInput('EUR'));
    expect(eur.name).toBe(IbanBankName.OLKY);

    const chf = await service.getBank(createBankSelectorInput('CHF', 10000));
    expect(chf.name).toBe(IbanBankName.YAPEAL);
  });
});

describe('Bank Frick country routing', () => {
  const bank = Object.assign(new Bank(), { name: IbanBankName.FRICK });

  it('uses the existing automated-bank country allowlist', () => {
    expect(bank.isCountryEnabled(createCustomCountry({ yapealEnable: true }))).toBe(true);
    expect(bank.isCountryEnabled(createCustomCountry({ yapealEnable: false }))).toBe(false);
  });
});

describe('BankService blockchainToBankName / isBankMatching (Frick)', () => {
  beforeEach(() => {
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
  });

  it('maps Blockchain.FRICK to IbanBankName.FRICK', () => {
    expect(BankService['blockchainToBankName'](Blockchain.FRICK)).toBe(IbanBankName.FRICK);
  });

  it('matches a Frick custody asset against the cached Frick IBAN', () => {
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
      `${IbanBankName.FRICK}-EUR`,
      'LI75088110105923K000E',
    );
    const asset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR' });

    expect(BankService.isBankMatching(asset, 'LI75088110105923K000E')).toBe(true);
    expect(BankService.isBankMatching(asset, 'OTHER-IBAN')).toBe(false);
  });
});

describe('Bank.isReconcilable', () => {
  it('is false only for a Frick row with send=true and receive=false', () => {
    expect(Object.assign(new Bank(), { name: IbanBankName.FRICK, send: true, receive: false }).isReconcilable).toBe(
      false,
    );
  });

  it.each([
    [true, true],
    [false, true],
    [false, false],
  ])('is true for a Frick row with send=%s and receive=%s', (send, receive) => {
    expect(Object.assign(new Bank(), { name: IbanBankName.FRICK, send, receive }).isReconcilable).toBe(true);
  });

  it('is always true for a non-Frick bank, regardless of send/receive', () => {
    expect(Object.assign(new Bank(), { name: IbanBankName.YAPEAL, send: true, receive: false }).isReconcilable).toBe(
      true,
    );
  });
});

describe('Bank (name, currency) collision tie-break', () => {
  let service: BankService;
  let bankRepo: BankRepository;

  beforeEach(async () => {
    bankRepo = createMock<BankRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankService,
        { provide: BankRepository, useValue: bankRepo },
        { provide: UserService, useValue: createMock<UserService>() },
        { provide: BuyCryptoService, useValue: createMock<BuyCryptoService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: CountryService, useValue: createMock<CountryService>() },
        { provide: BankAccountService, useValue: createMock<BankAccountService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BankService>(BankService);
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
  });

  it('resolves a (name, currency) collision without asset links by preferring the newest row (highest id)', async () => {
    const legacyRow = Object.assign(new Bank(), {
      id: 3,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LEGACY-DEAD-ACCOUNT-IBAN',
    });
    const newRow = Object.assign(new Bank(), {
      id: 99,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'NEW-ROW-IBAN',
    });
    // Returned newest-first, mirroring `order: { id: 'DESC' }`. Neither row is asset-linked, so the
    // newest row must win (stale-legacy safeguard).
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue([newRow, legacyRow]);

    const result = await service.getBankInternal(IbanBankName.FRICK, 'EUR');

    expect(result.iban).toBe('NEW-ROW-IBAN');
    expect(result.id).toBe(99);
    expect(bankRepo.findCached).toHaveBeenCalledWith(`${IbanBankName.FRICK}-EUR`, {
      where: { name: IbanBankName.FRICK, currency: 'EUR' },
      order: { id: 'DESC' },
      relations: { asset: true },
    });
  });

  it('loads the iban cache ordered by id descending, so without asset links the newest row per (name, currency) wins', async () => {
    const legacyRow = Object.assign(new Bank(), {
      id: 3,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LEGACY-DEAD-ACCOUNT-IBAN',
    });
    const newRow = Object.assign(new Bank(), {
      id: 99,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'NEW-ROW-IBAN',
    });
    // Requested in descending order - the mock returns them already sorted, mirroring what an
    // `order: { id: 'DESC' }` query would produce. No asset links → newest row wins.
    jest.spyOn(bankRepo, 'find').mockResolvedValue([newRow, legacyRow]);

    await service.onModuleInit();
    // onModuleInit fires the load without awaiting it; give the microtask queue a turn to settle.
    await new Promise(process.nextTick);

    expect(bankRepo.find).toHaveBeenCalledWith({ order: { id: 'DESC' }, relations: { asset: true } });
    expect((BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.get('Bank Frick-EUR')).toBe(
      'NEW-ROW-IBAN',
    );
  });

  it('prefers the older asset-linked Yapeal/EUR row when a newer unbound duplicate exists', async () => {
    // Production shape: two Yapeal/EUR rows; the older one is bound to the custody asset (and its IBAN
    // is on booked bank_tx), the newer one has no asset. Newest-only resolution would break isBankMatching.
    const assetLinked = Object.assign(new Bank(), {
      id: 10,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-ASSET-LINKED-IBAN',
      asset: {},
    });
    const unboundNewer = Object.assign(new Bank(), {
      id: 20,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-UNBOUND-NEWER-IBAN',
    });
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue([unboundNewer, assetLinked]);

    const result = await service.getBankInternal(IbanBankName.YAPEAL, 'EUR');

    expect(result.id).toBe(10);
    expect(result.iban).toBe('YAPEAL-ASSET-LINKED-IBAN');
  });

  it('prefers the newest asset-linked row when several rows are asset-linked', async () => {
    const olderLinked = Object.assign(new Bank(), {
      id: 10,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-OLDER-LINKED-IBAN',
      asset: {},
    });
    const newerLinked = Object.assign(new Bank(), {
      id: 20,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-NEWER-LINKED-IBAN',
      asset: {},
    });
    const unboundNewest = Object.assign(new Bank(), {
      id: 30,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-UNBOUND-NEWEST-IBAN',
    });
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue([unboundNewest, newerLinked, olderLinked]);

    const result = await service.getBankInternal(IbanBankName.YAPEAL, 'EUR');

    expect(result.id).toBe(20);
    expect(result.iban).toBe('YAPEAL-NEWER-LINKED-IBAN');
  });

  it('caches the asset-linked IBAN so isBankMatching matches booked bank_tx and rejects the unbound newer row', async () => {
    const assetLinked = Object.assign(new Bank(), {
      id: 10,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-ASSET-LINKED-IBAN',
      asset: {},
    });
    const unboundNewer = Object.assign(new Bank(), {
      id: 20,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      iban: 'YAPEAL-UNBOUND-NEWER-IBAN',
    });
    jest.spyOn(bankRepo, 'find').mockResolvedValue([unboundNewer, assetLinked]);

    await service.onModuleInit();
    await new Promise(process.nextTick);

    expect((BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.get('Yapeal-EUR')).toBe(
      'YAPEAL-ASSET-LINKED-IBAN',
    );

    const asset = createCustomAsset({ blockchain: Blockchain.YAPEAL, dexName: 'EUR' });
    expect(BankService.isBankMatching(asset, 'YAPEAL-ASSET-LINKED-IBAN')).toBe(true);
    expect(BankService.isBankMatching(asset, 'YAPEAL-UNBOUND-NEWER-IBAN')).toBe(false);
  });
});
