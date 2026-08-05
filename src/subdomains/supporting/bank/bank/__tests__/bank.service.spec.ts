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
import { createCustomVirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIban, VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanRepository } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.repository';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FindOneOptions, FindOptionsWhere } from 'typeorm';
import {
  createCustomBank,
  createDefaultBanks,
  createDefaultDisabledBanks,
  yapealCHF,
  yapealEUR,
  olkyEUR,
  frickEUR,
} from '../__mocks__/bank.entity.mock';
import { Bank } from '../bank.entity';
import { BankRepository } from '../bank.repository';
import { BankSelectorInput, BankService } from '../bank.service';
import { IbanBankName } from '../dto/bank.dto';
import { ReceiveIbanStatus } from '../dto/receive-iban.enum';

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

function mockFindCachedByForBanks(bankRepo: BankRepository, banks: Bank[]): void {
  jest
    .spyOn(bankRepo, 'findCachedBy')
    .mockImplementation(async (_key: number | string, where: FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[]) => {
      // getReceiveBanks always supplies one object; fail visibly if that contract changes.
      if (Array.isArray(where)) throw new Error('mockFindCachedByForBanks does not support array filters');

      const receive = where.receive;
      if (typeof receive === 'boolean') return banks.filter((bank) => bank.receive === receive);
      return banks;
    });
}

function mockFindCachedForBanks(bankRepo: BankRepository, banks: Bank[]): void {
  jest
    .spyOn(bankRepo, 'findCached')
    .mockImplementation(async (_key: number | string, options?: FindOneOptions<Bank>) => {
      const where = options?.where;
      if (!where) return banks;
      // getBankInternal always supplies one object; fail visibly if that contract changes, rather
      // than casting the array variant away and silently matching nothing.
      if (Array.isArray(where)) throw new Error('mockFindCachedForBanks does not support array filters');
      return banks.filter(
        (bank) =>
          (where.name === undefined || bank.name === where.name) &&
          (where.currency === undefined || bank.currency === where.currency),
      );
    });
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
        { provide: VirtualIbanRepository, useValue: createMock<VirtualIbanRepository>() },
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
    mockFindCachedByForBanks(bankRepo, allBanks);
    mockFindCachedForBanks(bankRepo, []);
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('provides an explicit bank-by-id database read when the repository cache is stale', async () => {
    const staleCachedBank = Object.assign(new Bank(), { id: 19, receive: true });
    const disabledDatabaseBank = Object.assign(new Bank(), { id: 19, receive: false });
    jest.spyOn(bankRepo, 'findOneCachedBy').mockResolvedValue(staleCachedBank);
    jest.spyOn(bankRepo, 'findOneBy').mockResolvedValue(disabledDatabaseBank);

    await expect(service.getBankByIdUncached(19)).resolves.toBe(disabledDatabaseBank);
    expect(bankRepo.findOneBy).toHaveBeenCalledWith({ id: 19 });
    expect(bankRepo.findOneCachedBy).not.toHaveBeenCalled();
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

  it('identifies IBANs from any configured bank as known', async () => {
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue(createDefaultBanks());

    await expect(service.areKnownBankIbans(` ${olkyEUR.iban.toLowerCase()} `, yapealEUR.iban)).resolves.toBe(true);
    await expect(service.areKnownBankIbans(olkyEUR.iban, 'UNKNOWN-IBAN')).resolves.toBe(false);
  });

  // Callers pass IBANs straight out of request bodies that are not all trimAll-normalized (e.g.
  // TransactionIssueDto.senderIban is only HTML-sanitized), so separators *inside* the value have to
  // be stripped too — surrounding whitespace alone is not enough.
  it('identifies a known IBAN written with embedded separators', async () => {
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue(createDefaultBanks());

    const paperFormat = olkyEUR.iban.replace(/(.{4})/g, '$1 ').trim();
    expect(paperFormat).not.toEqual(olkyEUR.iban);

    await expect(service.areKnownBankIbans(paperFormat)).resolves.toBe(true);
    await expect(service.areKnownBankIbans(olkyEUR.iban.replace(/(.{4})/g, '$1-'))).resolves.toBe(true);
  });

  it('routes BANK EUR deposits to Bank Frick regardless of bank order', async () => {
    const incumbent = createCustomBank({ ...olkyEUR, receive: true });
    const frick = createCustomBank({ ...frickEUR, receive: true });
    mockFindCachedByForBanks(bankRepo, [incumbent, frick]);
    mockFindCachedForBanks(bankRepo, [incumbent, frick]);

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.BANK));
    expect(result).toBe(frick);
  });

  it('prefers the older asset-linked Bank Frick EUR row for a BANK EUR deposit', async () => {
    // Production shape: the older row owns the custody asset and its IBAN is used by isBankMatching
    // and the Financial Log. Returning the newer unbound row would detach the customer IBAN from
    // that attribution. The mock order mirrors `order: { id: 'DESC' }` from getBankInternal.
    const assetLinkedFrick = Object.assign(
      createCustomBank({
        ...frickEUR,
        id: 101,
        receive: true,
        iban: 'LI75088110105923K0101',
      }),
      { asset: {} },
    );
    const unboundNewerFrick = createCustomBank({
      ...frickEUR,
      id: 202,
      receive: true,
      iban: 'LI75088110105923K0202',
    });
    const banks = [unboundNewerFrick, assetLinkedFrick];
    mockFindCachedByForBanks(bankRepo, banks);
    mockFindCachedForBanks(bankRepo, banks);

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.BANK));
    expect(result).toBe(assetLinkedFrick);
    expect(result.iban).toBe('LI75088110105923K0101');
  });

  it('picks the EUR Bank Frick row, not its CHF row, for an EUR deposit', async () => {
    // The CHF row is listed first on purpose: the getBankInternal query matches on bank name AND
    // currency. Without the currency check a customer paying in EUR could be handed the franc
    // account's IBAN, and no other test in this file would notice.
    const frickChfRow = createCustomBank({
      name: IbanBankName.FRICK,
      currency: 'CHF',
      receive: true,
      iban: 'FRICK-CHF-ROW',
      bic: 'BFRILI22',
    });
    const frickEurRow = createCustomBank({ ...frickEUR, receive: true });
    mockFindCachedByForBanks(bankRepo, [frickChfRow, frickEurRow]);
    mockFindCachedForBanks(bankRepo, [frickChfRow, frickEurRow]);

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result).toBe(frickEurRow);
    expect(result.currency).toBe('EUR');
  });

  it('falls back to the established EUR receiver when Bank Frick is not receiving', async () => {
    const disabledFrick = createCustomBank({ ...frickEUR, receive: false });
    const incumbent = createCustomBank({ ...olkyEUR, receive: true });
    mockFindCachedByForBanks(bankRepo, [disabledFrick, incumbent]);
    mockFindCachedForBanks(bankRepo, [disabledFrick, incumbent]);

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result).toBe(incumbent);
  });

  it('does not substitute another Bank Frick row when the attributed one is not receiving', async () => {
    // The attributed (asset-linked) row is disabled while a second, unbound Frick row still receives.
    // The rule must not fall through to that one: attribution stays on the disabled row, so paying
    // into the unbound IBAN would book against a row nothing is keyed on. The incumbent wins instead.
    const attributedDisabled = createCustomBank({
      ...frickEUR,
      id: 19,
      receive: false,
      asset: createCustomAsset({}),
      iban: 'FRICK-ATTRIBUTED-DISABLED',
    });
    const unboundReceiving = createCustomBank({
      ...frickEUR,
      id: 77,
      receive: true,
      asset: null,
      iban: 'FRICK-UNBOUND-RECEIVING',
    });
    const incumbent = createCustomBank({ ...olkyEUR, receive: true });
    mockFindCachedByForBanks(bankRepo, [attributedDisabled, unboundReceiving, incumbent]);
    mockFindCachedForBanks(bankRepo, [attributedDisabled, unboundReceiving]);

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result).toBe(incumbent);
  });

  it('leaves CHF bank selection unaffected by the Bank Frick EUR rule', async () => {
    const frick = createCustomBank({ ...frickEUR, receive: true });
    const chf = createCustomBank({ ...yapealCHF, receive: true });
    mockFindCachedByForBanks(bankRepo, [frick, chf]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('CHF'));
    expect(result).toBe(chf);
  });

  it('does not let a Bank Frick CHF row capture a CHF request', async () => {
    const frickChf = createCustomBank({
      name: IbanBankName.FRICK,
      currency: 'CHF',
      receive: true,
      iban: 'LI75088110105923K0CHF',
      bic: 'BFRILI22',
    });
    const chf = createCustomBank({ ...yapealCHF, receive: true });
    mockFindCachedByForBanks(bankRepo, [frickChf, chf]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('CHF'));
    expect(result).toBe(chf);
  });

  it('uses an instant-capable EUR bank instead of Bank Frick for INSTANT payments', async () => {
    const frick = createCustomBank({ ...frickEUR, receive: true, sctInst: false });
    const instantBank = createCustomBank({ ...olkyEUR, receive: true, sctInst: true });
    mockFindCachedByForBanks(bankRepo, [frick, instantBank]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result).toBe(instantBank);
  });

  it('falls back to an incumbent EUR bank when no EUR bank supports INSTANT', async () => {
    const frick = createCustomBank({ ...frickEUR, receive: true, sctInst: false });
    const incumbent = createCustomBank({ ...olkyEUR, receive: true, sctInst: false });
    mockFindCachedByForBanks(bankRepo, [frick, incumbent]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result).toBe(incumbent);
    expect(result).not.toBe(frick);
  });

  it('uses an incumbent EUR bank instead of Bank Frick for CARD payments', async () => {
    const frick = createCustomBank({ ...frickEUR, receive: true });
    const incumbent = createCustomBank({ ...olkyEUR, receive: true });
    mockFindCachedByForBanks(bankRepo, [frick, incumbent]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.CARD));
    expect(result).toBe(incumbent);
    expect(result).not.toBe(frick);
  });

  it.each([
    ['Bank Frick first', true],
    ['incumbent first', false],
  ])('uses the incumbent EUR fallback for unsupported currency with %s', async (_description, frickFirst) => {
    const frick = createCustomBank({ ...frickEUR, receive: true });
    const incumbent = createCustomBank({ ...olkyEUR, receive: true });
    const banks = frickFirst ? [frick, incumbent] : [incumbent, frick];
    mockFindCachedByForBanks(bankRepo, banks);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('GBP'));
    expect(result).toBe(incumbent);
    expect(result).not.toBe(frick);
  });

  it('returns undefined when neither the requested currency nor the EUR fallback can receive', async () => {
    const disabledGbp = createCustomBank({ currency: 'GBP', receive: false });
    const disabledEur = createCustomBank({ ...olkyEUR, receive: false });
    mockFindCachedByForBanks(bankRepo, [disabledGbp, disabledEur]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('GBP'));
    expect(result).toBeUndefined();
  });

  it('uses an instant-capable EUR fallback when GBP has no instant account', async () => {
    const gbpBank = createCustomBank({ currency: 'GBP', receive: true, sctInst: false });
    const eurInstantBank = createCustomBank({ ...olkyEUR, receive: true, sctInst: true });
    mockFindCachedByForBanks(bankRepo, [gbpBank, eurInstantBank]);
    mockFindCachedForBanks(bankRepo, []);

    const result = await service.getBank(createBankSelectorInput('GBP', undefined, FiatPaymentMethod.INSTANT));
    expect(result).toBe(eurInstantBank);
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
    (BankService as unknown as { unboundIbanCache: Map<string, Set<string>> }).unboundIbanCache.clear();
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

  it('does not match missing or invalid IBANs when no cache entry exists', () => {
    const asset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR' });

    expect(BankService.isBankMatching(asset, undefined as unknown as string)).toBe(false);
    expect(BankService.isBankMatching(asset, '---')).toBe(false);
  });

  it('prefers the related bank IBAN when the asset relation is loaded', () => {
    const asset = createCustomAsset({ bank: frickEUR });

    expect(BankService.isBankMatching(asset, frickEUR.iban.toLowerCase())).toBe(true);
    expect(BankService.isBankMatching(asset, olkyEUR.iban)).toBe(false);
  });

  it('matches a configured unbound IBAN to the corresponding bank asset for internal transfers', () => {
    const unboundIban = 'LI75088110105923UNBOUND';
    (BankService as unknown as { unboundIbanCache: Map<string, Set<string>> }).unboundIbanCache.set(
      unboundIban,
      new Set([`${IbanBankName.FRICK}-EUR`]),
    );
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
      `${IbanBankName.FRICK}-EUR`,
      frickEUR.iban,
    );
    const asset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR', bank: frickEUR });

    expect(BankService.isInternalBankMatching(asset, unboundIban)).toBe(true);
    expect(BankService.isBankMatching(asset, unboundIban)).toBe(false);
  });

  it('does not attribute one asset-bound IBAN to another asset of the same bank and currency', () => {
    const firstBank = Object.assign(new Bank(), {
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LI75088110105923FIRST',
      asset: { id: 1 },
    });
    const secondBank = Object.assign(new Bank(), {
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LI75088110105923SECOND',
      asset: { id: 2 },
    });
    BankService['setIbanAttributionCache']([firstBank, secondBank]);
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
      `${IbanBankName.FRICK}-EUR`,
      firstBank.iban,
    );

    const firstAsset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR', bank: firstBank });
    const secondAsset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR', bank: secondBank });

    expect(BankService.isInternalBankMatching(firstAsset, secondBank.iban)).toBe(false);
    expect(BankService.isInternalBankMatching(secondAsset, secondBank.iban)).toBe(true);
  });

  it('attributes an unbound IBAN to only the selected asset when two assets share bank and currency', () => {
    const unboundBank = Object.assign(new Bank(), {
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LI75088110105923UNBOUND',
    });
    const firstBank = Object.assign(new Bank(), {
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LI75088110105923FIRST',
      asset: { id: 1 },
    });
    const secondBank = Object.assign(new Bank(), {
      name: IbanBankName.FRICK,
      currency: 'EUR',
      iban: 'LI75088110105923SECOND',
      asset: { id: 2 },
    });
    BankService['setIbanAttributionCache']([unboundBank, firstBank, secondBank]);
    (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
      `${IbanBankName.FRICK}-EUR`,
      firstBank.iban,
    );

    const firstAsset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR', bank: firstBank });
    const secondAsset = createCustomAsset({ blockchain: Blockchain.FRICK, dexName: 'EUR', bank: secondBank });

    expect(BankService.isInternalBankMatching(firstAsset, unboundBank.iban)).toBe(true);
    expect(BankService.isInternalBankMatching(secondAsset, unboundBank.iban)).toBe(false);
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
        { provide: VirtualIbanRepository, useValue: createMock<VirtualIbanRepository>() },
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

describe('BankService.getReceiveIbanStatus', () => {
  const accountId = 42;
  const otherAccountId = 43;

  // A retired collective account: same IBAN a customer may have transferred to years ago, but receive=false today.
  const retiredCollectiveAccount = createCustomBank({ iban: 'CH5604835012345678009', receive: false, send: false });
  const personalIban = 'DE89370400440532013000';
  const expiredPersonalIban = 'AT483200000012345864';
  const foreignPersonalIban = 'CH4431999123000889012';

  let service: BankService;
  let bankRepo: BankRepository;
  let virtualIbanRepo: VirtualIbanRepository;

  beforeEach(async () => {
    bankRepo = createMock<BankRepository>();
    virtualIbanRepo = createMock<VirtualIbanRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankService,
        { provide: BankRepository, useValue: bankRepo },
        { provide: VirtualIbanRepository, useValue: virtualIbanRepo },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BankService>(BankService);
  });

  // The only shape getReceiveIbanStatus passes to findCachedBy; keeps the mock typed without `any`.
  type AccountScopedWhere = { userData: { id: number } };

  function setup(banks: Bank[], virtualIbansByAccount: Map<number, VirtualIban[]> = new Map()): void {
    jest.spyOn(bankRepo, 'findCached').mockResolvedValue(banks);
    jest
      .spyOn(virtualIbanRepo, 'findCachedBy')
      .mockImplementation(
        async (_key: string | number, where: AccountScopedWhere) => virtualIbansByAccount.get(where.userData.id) ?? [],
      );
  }

  it('reports a collective account IBAN as a DFX IBAN, without asking for personal IBANs', async () => {
    // A collective account hit short-circuits for a logged-in caller too - no account-scoped lookup happens.
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus(olkyEUR.iban, accountId)).resolves.toBe(ReceiveIbanStatus.DFX_IBAN);
    expect(virtualIbanRepo.findCachedBy).not.toHaveBeenCalled();
  });

  it('reports a collective account IBAN as a DFX IBAN without a login, before ever asking for personal IBANs', async () => {
    // The bank check must run before the login check, otherwise a logged-out customer gets LoginRequired for
    // an IBAN we can already confirm.
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus(olkyEUR.iban)).resolves.toBe(ReceiveIbanStatus.DFX_IBAN);
    expect(virtualIbanRepo.findCachedBy).not.toHaveBeenCalled();
  });

  it('reports a collective account IBAN stored in paper format as a DFX IBAN', async () => {
    // The stored side is normalized too, so a row that carries a grouped value still matches.
    setup([createCustomBank({ iban: 'LU11 6060 0020 0000 5040' })]);

    await expect(service.getReceiveIbanStatus('LU116060002000005040', accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
  });

  it('reports a personal IBAN stored in paper format as a DFX IBAN', async () => {
    // The comparison normalizes stored virtual_iban values as well, so their format need not be guaranteed.
    setup(
      createDefaultBanks(),
      new Map([[accountId, [createCustomVirtualIban({ iban: 'de89 3704 0044 0532 0130 00' })]]]),
    );

    await expect(service.getReceiveIbanStatus(personalIban, accountId)).resolves.toBe(ReceiveIbanStatus.DFX_IBAN);
  });

  it('reports a collective account IBAN with receive=false as a DFX IBAN', async () => {
    // A retired or closed account still received DFX money, and a missing transfer can predate it being stood down.
    setup([retiredCollectiveAccount]);

    await expect(service.getReceiveIbanStatus(retiredCollectiveAccount.iban, accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
  });

  it('reports a personal IBAN of the requesting account as a DFX IBAN', async () => {
    setup(createDefaultBanks(), new Map([[accountId, [createCustomVirtualIban({ iban: personalIban })]]]));

    await expect(service.getReceiveIbanStatus(personalIban, accountId)).resolves.toBe(ReceiveIbanStatus.DFX_IBAN);
    expect(virtualIbanRepo.findCachedBy).toHaveBeenCalledWith(`user-${accountId}`, { userData: { id: accountId } });
  });

  it.each([VirtualIbanStatus.EXPIRED, VirtualIbanStatus.DEACTIVATED, VirtualIbanStatus.RESERVED])(
    'reports a personal IBAN with status %s as a DFX IBAN',
    async (status) => {
      // An expired personal IBAN was still a real receiving IBAN, so no lifecycle state may be filtered out.
      setup(
        createDefaultBanks(),
        new Map([[accountId, [createCustomVirtualIban({ iban: expiredPersonalIban, active: false, status })]]]),
      );

      await expect(service.getReceiveIbanStatus(expiredPersonalIban, accountId)).resolves.toBe(
        ReceiveIbanStatus.DFX_IBAN,
      );
    },
  );

  it('reports a formally invalid IBAN as invalid, without querying any IBAN', async () => {
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus('DE123456', accountId)).resolves.toBe(ReceiveIbanStatus.INVALID_IBAN);
    expect(bankRepo.findCached).not.toHaveBeenCalled();
    expect(virtualIbanRepo.findCachedBy).not.toHaveBeenCalled();
  });

  it('reports a correctly shaped IBAN with a wrong checksum as invalid, not as unmatched', async () => {
    // A changed digit keeps the country and length intact, so only the checksum catches it. Answering
    // NotMatched here would send a customer looking for a transfer that never left with a typo in the IBAN.
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus('DE89370400440532013001', accountId)).resolves.toBe(
      ReceiveIbanStatus.INVALID_IBAN,
    );
  });

  it.each([undefined, null, '', '   '])(
    'reports an unusable input (%p) as invalid instead of throwing',
    async (input) => {
      // Defensive only: @IsString/@IsNotEmpty reject undefined, null and '' with a 400 before the service is
      // reached, so of these only '   ' can actually arrive. The typeof guard in normalizeIban short-circuits
      // the non-string cases, and an all-separator string normalizes to '' and is returned as null.
      // The cast stays because getReceiveIbanStatus itself declares `iban: string`; it is what lets the test
      // reach the guard from outside the type system, which is exactly the situation the guard exists for.
      setup(createDefaultBanks());

      await expect(service.getReceiveIbanStatus(input as string, accountId)).resolves.toBe(
        ReceiveIbanStatus.INVALID_IBAN,
      );
    },
  );

  it('reports a valid IBAN that matched neither list as not matched when the customer is logged in', async () => {
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus(foreignPersonalIban, accountId)).resolves.toBe(
      ReceiveIbanStatus.NOT_MATCHED,
    );
  });

  it('requires a login for a valid unmatched IBAN, because personal IBANs stay unchecked without one', async () => {
    setup(createDefaultBanks());

    await expect(service.getReceiveIbanStatus(foreignPersonalIban)).resolves.toBe(ReceiveIbanStatus.LOGIN_REQUIRED);
    expect(virtualIbanRepo.findCachedBy).not.toHaveBeenCalled();
  });

  it('recognizes the same IBAN written with grouping spaces and in lower case', async () => {
    setup(createDefaultBanks(), new Map([[accountId, [createCustomVirtualIban({ iban: personalIban })]]]));

    await expect(service.getReceiveIbanStatus('lu11 6060 0020 0000 5040', accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
    await expect(service.getReceiveIbanStatus('de89 3704 0044 0532 0130 00', accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
  });

  // The invisible separators are written as escape sequences on purpose: it makes them visible in review and
  // lowers the risk of an edit or a copy-paste quietly normalizing them into ordinary spaces, which would
  // void exactly those cases.
  it.each([
    ['an ASCII space', ' '],
    ['a hyphen', '-'],
    ['a dot', '.'],
    ['a slash', '/'],
    ['a non-breaking space', '\u00a0'],
    ['a narrow non-breaking space', '\u202f'],
    ['a zero-width space', '\u200b'],
    ['a soft hyphen', '\u00ad'],
    ['a tab', '\t'],
    ['a line break', '\n'],
  ])('recognizes an IBAN grouped with %s', async (_name, separator) => {
    setup([frickEUR], new Map([[accountId, [createCustomVirtualIban({ iban: personalIban })]]]));

    const group = (iban: string): string => (iban.match(/.{1,4}/g) ?? []).join(separator);

    await expect(service.getReceiveIbanStatus(group(frickEUR.iban), accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
    await expect(service.getReceiveIbanStatus(group(personalIban), accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
  });

  it('recognizes an IBAN pasted with surrounding quotes', async () => {
    setup([frickEUR]);

    await expect(service.getReceiveIbanStatus('"LI75 0881 1010 5923 K000E"', accountId)).resolves.toBe(
      ReceiveIbanStatus.DFX_IBAN,
    );
  });

  it('does not extract an IBAN out of surrounding ASCII words', async () => {
    // Separators are stripped, an ASCII label is not: it survives normalization and makes the value invalid,
    // which is what we want - a prefix is indistinguishable from extra characters that corrupt the IBAN.
    // The guarantee is ASCII-only by construction: a label in a non-Latin script is stripped like a
    // separator and the IBAN is accepted. Harmless, but the reason this test says "ASCII".
    setup([frickEUR]);

    await expect(service.getReceiveIbanStatus('IBAN: LI75 0881 1010 5923 K000E', accountId)).resolves.toBe(
      ReceiveIbanStatus.INVALID_IBAN,
    );
  });

  it('never reports a personal IBAN of another account as a DFX IBAN', async () => {
    setup(
      createDefaultBanks(),
      new Map([
        [accountId, [createCustomVirtualIban({ iban: personalIban })]],
        [otherAccountId, [createCustomVirtualIban({ iban: foreignPersonalIban })]],
      ]),
    );

    await expect(service.getReceiveIbanStatus(foreignPersonalIban, accountId)).resolves.toBe(
      ReceiveIbanStatus.NOT_MATCHED,
    );
  });
});
