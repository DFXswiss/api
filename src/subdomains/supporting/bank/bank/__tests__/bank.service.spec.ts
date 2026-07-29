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
import {
  createCustomBank,
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

  it('keeps the incumbent deposit bank while every row carries the default receivePriority, even with Frick listed first', async () => {
    // Deploy-safety invariant with the REAL production ids: as long as Ops has not lowered any
    // priority, Frick must not take over a currency merely by being listed first. This is no longer a
    // bank-name exclusion - Frick becomes selectable the moment its receivePriority is lowered (see
    // the dedicated test below); here every row still sits at the neutral default, so ascending id
    // decides and the incumbents (Olkypay id 4, Yapeal id 15) keep their currencies.
    // A preceding test disables the shared olkyEUR mock in place (createDefaultDisabledBanks mutates it),
    // so restore its natural receive state here to exercise the priority ordering rather than that
    // leaked state.
    olkyEUR.receive = true;
    // Routed through createCustomBank so these stay real Bank instances: the shared mocks carry no id,
    // and a plain spread would drop the entity methods the repository contract promises.
    const frickFirst = [
      createCustomBank({ ...frickEUR, id: 19 }),
      createCustomBank({ ...frickCHF, id: 20 }),
      createCustomBank({ ...olkyEUR, id: 4 }),
      createCustomBank({ ...yapealEUR, id: 16 }),
      createCustomBank({ ...yapealCHF, id: 15 }),
    ];
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      if (filter?.receive !== undefined) return frickFirst.filter((b) => b.receive === filter.receive);
      return frickFirst;
    });

    const eur = await service.getBank(createBankSelectorInput('EUR'));
    expect(eur.name).toBe(IbanBankName.OLKY);

    const chf = await service.getBank(createBankSelectorInput('CHF', 10000));
    expect(chf.name).toBe(IbanBankName.YAPEAL);
  });

  it('picks the lower id when two EUR receive banks share the default receivePriority', async () => {
    // Deploy-safety invariant: with the neutral default (1000) on every row, ascending id decides —
    // same outcome as today (Olkypay id 4 before Frick id 19) without any bank-name filter.
    const lowerId = createCustomBank({
      id: 4,
      name: IbanBankName.OLKY,
      currency: 'EUR',
      receive: true,
      receivePriority: 1000,
      iban: 'LOWER-ID-EUR',
      bic: 'LOWERBIC',
    });
    const higherId = createCustomBank({
      id: 19,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      receive: true,
      receivePriority: 1000,
      iban: 'HIGHER-ID-EUR',
      bic: 'HIGHERBIC',
    });
    // Higher id listed first so only the sort (not input order) can pick the lower id.
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      const banks = [higherId, lowerId];
      if (filter?.receive !== undefined) return banks.filter((b) => b.receive === filter.receive);
      return banks;
    });

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result.id).toBe(4);
    expect(result.iban).toBe('LOWER-ID-EUR');
  });

  it('picks the bank with lower receivePriority over a lower id', async () => {
    const lowPriorityHighId = createCustomBank({
      id: 50,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      receive: true,
      receivePriority: 100,
      iban: 'PRIORITY-WINNER',
      bic: 'WINBIC',
    });
    const highPriorityLowId = createCustomBank({
      id: 5,
      name: IbanBankName.OLKY,
      currency: 'EUR',
      receive: true,
      receivePriority: 500,
      iban: 'PRIORITY-LOSER',
      bic: 'LOSEBIC',
    });
    // Winner listed last so only receivePriority (not input order or id) can select it.
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      const banks = [highPriorityLowId, lowPriorityHighId];
      if (filter?.receive !== undefined) return banks.filter((b) => b.receive === filter.receive);
      return banks;
    });

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result.id).toBe(50);
    expect(result.iban).toBe('PRIORITY-WINNER');
  });

  it('offers Bank Frick as deposit target when it has the lowest receivePriority', async () => {
    const olky = createCustomBank({
      id: 4,
      name: IbanBankName.OLKY,
      currency: 'EUR',
      receive: true,
      receivePriority: 1000,
      iban: 'OLKY-EUR',
      bic: 'OLKYBIC',
    });
    const frick = createCustomBank({
      id: 19,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      receive: true,
      receivePriority: 10,
      iban: 'FRICK-EUR',
      bic: 'FRICKBIC',
    });
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      const banks = [olky, frick];
      if (filter?.receive !== undefined) return banks.filter((b) => b.receive === filter.receive);
      return banks;
    });

    const result = await service.getBank(createBankSelectorInput('EUR'));
    expect(result.name).toBe(IbanBankName.FRICK);
    expect(result.iban).toBe('FRICK-EUR');
  });

  it('respects receivePriority among sctInst banks for INSTANT payments', async () => {
    const highPriorityInst = createCustomBank({
      id: 1,
      name: IbanBankName.OLKY,
      currency: 'EUR',
      receive: true,
      sctInst: true,
      receivePriority: 200,
      iban: 'INST-LOSER',
      bic: 'LOSEBIC',
    });
    const lowPriorityInst = createCustomBank({
      id: 2,
      name: IbanBankName.YAPEAL,
      currency: 'EUR',
      receive: true,
      sctInst: true,
      receivePriority: 50,
      iban: 'INST-WINNER',
      bic: 'WINBIC',
    });
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      const banks = [highPriorityInst, lowPriorityInst];
      if (filter?.receive !== undefined) return banks.filter((b) => b.receive === filter.receive);
      return banks;
    });

    const result = await service.getBank(createBankSelectorInput('EUR', undefined, FiatPaymentMethod.INSTANT));
    expect(result.iban).toBe('INST-WINNER');
    expect(result.id).toBe(2);
  });

  it('applies receivePriority when falling back to EUR for an unsupported currency', async () => {
    const eurLoser = createCustomBank({
      id: 4,
      name: IbanBankName.OLKY,
      currency: 'EUR',
      receive: true,
      receivePriority: 300,
      iban: 'EUR-FALLBACK-LOSER',
      bic: 'LOSEBIC',
    });
    const eurWinner = createCustomBank({
      id: 19,
      name: IbanBankName.FRICK,
      currency: 'EUR',
      receive: true,
      receivePriority: 50,
      iban: 'EUR-FALLBACK-WINNER',
      bic: 'WINBIC',
    });
    // No GBP bank: currency fallback must still prefer the higher-priority EUR candidate.
    jest.spyOn(bankRepo, 'findCachedBy').mockImplementation(async (_key: string, filter?: any) => {
      const banks = [eurLoser, eurWinner];
      if (filter?.receive !== undefined) return banks.filter((b) => b.receive === filter.receive);
      return banks;
    });

    const result = await service.getBank(createBankSelectorInput('GBP'));
    expect(result.currency).toBe('EUR');
    expect(result.iban).toBe('EUR-FALLBACK-WINNER');
    expect(result.id).toBe(19);
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
