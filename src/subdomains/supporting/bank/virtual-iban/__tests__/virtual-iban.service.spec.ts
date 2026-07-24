import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { DataSource } from 'typeorm';
import { BankService } from '../../bank/bank.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { YapealVibanProvider } from '../providers/yapeal-viban.provider';
import { VirtualIban, VirtualIbanStatus } from '../virtual-iban.entity';
import { VirtualIbanIssuanceIntent, VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent.entity';
import { VirtualIbanRepository } from '../virtual-iban.repository';
import { VirtualIbanService } from '../virtual-iban.service';

describe('VirtualIbanService', () => {
  let service: VirtualIbanService;
  let virtualIbanRepo: VirtualIbanRepository;
  let bankService: BankService;
  let fiatService: FiatService;
  let yapealVibanProvider: YapealVibanProvider;
  let frickVibanProvider: FrickVibanProvider;
  let dataSource: DataSource;
  let manager: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let queryRunner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock; manager: typeof manager };

  const userData = { id: 7, kycLevel: KycLevel.LEVEL_50 } as UserData;
  const currency = { id: 1, name: 'CHF' };
  const bank = { id: 2, iban: 'CH9300762011623852957', receive: true, name: IbanBankName.YAPEAL };

  beforeEach(async () => {
    virtualIbanRepo = createMock<VirtualIbanRepository>();
    bankService = createMock<BankService>();
    fiatService = createMock<FiatService>();
    yapealVibanProvider = createMock<YapealVibanProvider>({
      bankName: IbanBankName.YAPEAL,
      currencies: ['CHF'],
    });
    frickVibanProvider = createMock<FrickVibanProvider>({
      bankName: IbanBankName.FRICK,
      currencies: ['EUR'],
    });
    manager = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager,
    };
    dataSource = createMock<DataSource>({ createQueryRunner: jest.fn().mockReturnValue(queryRunner) });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        VirtualIbanService,
        { provide: VirtualIbanRepository, useValue: virtualIbanRepo },
        { provide: BankService, useValue: bankService },
        { provide: FiatService, useValue: fiatService },
        { provide: YapealVibanProvider, useValue: yapealVibanProvider },
        { provide: FrickVibanProvider, useValue: frickVibanProvider },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<VirtualIbanService>(VirtualIbanService);
  });

  describe('isUserEligible', () => {
    it('returns true when a provider is available for the currency and KYC is at least LEVEL_50', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

      expect(service.isUserEligible('CHF', userData)).toBe(true);
    });

    it('returns false when no provider is available for the currency', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

      expect(service.isUserEligible('CHF', userData)).toBe(false);
    });

    it('returns false when providers exist but none supports the currency', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);

      expect(service.isUserEligible('USD', userData)).toBe(false);
    });

    it('returns false when KYC is below LEVEL_50 even if a provider is available', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

      expect(service.isUserEligible('CHF', { ...userData, kycLevel: KycLevel.LEVEL_40 } as UserData)).toBe(false);
    });

    it('returns false for EUR when only explicit-opt-in Frick is available', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);

      expect(service.isUserEligible('EUR', userData)).toBe(false);
    });
  });

  describe('createForUser', () => {
    beforeEach(() => {
      jest.spyOn(virtualIbanRepo, 'find').mockResolvedValue([]);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(currency as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(bank as any);
      jest.spyOn(yapealVibanProvider, 'reserveViban').mockResolvedValue({
        iban: 'CH4400762011623852958',
        bban: '761623852958',
        providerAccountRef: 'yapeal-uid-1',
      });
      jest.spyOn(virtualIbanRepo, 'create').mockImplementation((entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'save').mockImplementation(async (entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);
    });

    it('throws ConflictException when an active vIBAN already exists and never calls a provider', async () => {
      jest.spyOn(virtualIbanRepo, 'find').mockResolvedValue([{ id: 99, bank }] as VirtualIban[]);

      await expect(service.createForUser(userData, 'CHF')).rejects.toThrow(ConflictException);
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(bankService.getBankInternal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when currency is not found before any provider call', async () => {
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(undefined);

      await expect(service.createForUser(userData, 'CHF')).rejects.toThrow(
        new BadRequestException('Currency not found'),
      );
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(bankService.getBankInternal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no provider matches the currency', async () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

      await expect(service.createForUser(userData, 'CHF')).rejects.toThrow(
        new BadRequestException('No personal IBAN provider available for this currency'),
      );
      expect(bankService.getBankInternal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when bank has no receive account', async () => {
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue({ ...bank, receive: false } as any);

      await expect(service.createForUser(userData, 'CHF')).rejects.toThrow(
        new BadRequestException('No bank available for this currency'),
      );
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('creates a CHF vIBAN via Yapeal and persists providerAccountRef', async () => {
      const saved = await service.createForUser(userData, 'CHF');

      expect(bankService.getBankInternal).toHaveBeenCalledWith(IbanBankName.YAPEAL, 'CHF');
      expect(yapealVibanProvider.reserveViban).toHaveBeenCalledWith(bank.iban);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(virtualIbanRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userData,
          bank,
          currency,
          iban: 'CH4400762011623852958',
          bban: '761623852958',
          providerAccountRef: 'yapeal-uid-1',
          status: VirtualIbanStatus.ACTIVE,
          active: true,
          activatedAt: expect.any(Date),
        }),
      );
      const createArg = (virtualIbanRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg).not.toHaveProperty('yapealAccountUid');
      expect(virtualIbanRepo.save).toHaveBeenCalled();
      expect(virtualIbanRepo.invalidateCache).toHaveBeenCalled();
      expect(saved.providerAccountRef).toBe('yapeal-uid-1');
    });

    it('never uses Frick for generic EUR user-level creation', async () => {
      const eur = { id: 4, name: 'EUR' };
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(eur as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);

      await expect(service.createForUser(userData, 'EUR')).rejects.toThrow(
        'No personal IBAN provider available for this currency',
      );

      expect(bankService.getBankInternal).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
    });
  });

  describe('createForBuy', () => {
    it('conflict-checks buy+currency and persists buy + label from asset name', async () => {
      const buy = { id: 55, asset: { name: 'BTC' } } as Buy;
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue(null);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(currency as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(bank as any);
      jest.spyOn(yapealVibanProvider, 'reserveViban').mockResolvedValue({
        iban: 'CH4400762011623852958',
        bban: '761623852958',
        providerAccountRef: 'yapeal-uid-buy',
      });
      jest.spyOn(virtualIbanRepo, 'create').mockImplementation((entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'save').mockImplementation(async (entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);

      await service.createForBuy(userData, buy, 'CHF');

      expect(virtualIbanRepo.findOneCached).toHaveBeenCalledWith('buy-55-CHF', {
        where: {
          buy: { id: 55 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
      });
      expect(virtualIbanRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          buy,
          label: 'BTC',
          providerAccountRef: 'yapeal-uid-buy',
        }),
      );
    });

    it('throws ConflictException when buy already has an active personal IBAN', async () => {
      const buy = { id: 55, asset: { name: 'BTC' } } as Buy;
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue({ id: 1 } as VirtualIban);

      await expect(service.createForBuy(userData, buy, 'CHF')).rejects.toThrow(ConflictException);
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('never uses Frick for generic EUR buy-specific creation', async () => {
      const buy = { id: 55, asset: { name: 'BTC' } } as Buy;
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue(null);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue({ id: 4, name: 'EUR' } as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);

      await expect(service.createForBuy(userData, buy, 'EUR')).rejects.toThrow(
        'No personal IBAN provider available for this currency',
      );

      expect(bankService.getBankInternal).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateFrickForUser', () => {
    const eur = { id: 4, name: 'EUR' };
    const frickBank = {
      id: 19,
      iban: 'LI32088110105923K000C',
      receive: true,
      name: IbanBankName.FRICK,
    };
    const reserved = {
      iban: 'LI75088110105923K000E',
      providerAccountRef: 'LI75088110105923K000E',
    };

    beforeEach(() => {
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(eur as any);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);
      manager.create.mockImplementation((_entity, value) => value);
      manager.save.mockImplementation(async (value) => {
        if (value instanceof VirtualIban || value.iban) return { id: 501, ...value };
        return { id: 301, ...value };
      });
    });

    it('commits the technical intent as ISSUING before the single external POST and persists one user-level vIBAN', async () => {
      const events: string[] = [];
      manager.findOne.mockResolvedValue(null);
      manager.save.mockImplementation(async (value) => {
        if (value.status && !value.iban) events.push(`save-${value.status}`);
        else events.push('save-viban');
        return value.iban ? { id: 501, ...value } : { id: 301, ...value };
      });
      jest.spyOn(frickVibanProvider, 'reserveViban').mockImplementation(async (_iban, description) => {
        events.push('post');
        expect(description).toMatch(/^dfx-viban-[a-z0-9]{32}$/);
        return reserved;
      });

      const result = await service.getOrCreateFrickForUser(userData, 'EUR');

      expect(result).toMatchObject({ id: 501, iban: reserved.iban, buy: null });
      expect(events).toEqual(['save-Pending', 'save-Issuing', 'post', 'save-viban', 'save-Completed']);
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
      expect(queryRunner.query.mock.calls).toEqual([
        [expect.stringContaining('pg_advisory_lock'), ['viban-issuance:7:4:19']],
        [expect.stringContaining('pg_advisory_unlock'), ['viban-issuance:7:4:19']],
      ]);
      expect(queryRunner.release).toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(
        VirtualIban,
        expect.objectContaining({ userData, bank: frickBank, currency: eur, buy: null }),
      );
    });

    it('rechecks under the advisory lock and does not POST when a concurrent caller already persisted the vIBAN', async () => {
      const existing = {
        id: 77,
        iban: reserved.iban,
        bank: frickBank,
        currency: eur,
        userData,
        buy: null,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      } as VirtualIban;
      manager.findOne.mockResolvedValueOnce(existing);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toBe(existing);

      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(queryRunner.query).toHaveBeenCalledTimes(2);
    });

    it('reconciles an ISSUING intent after a crash between local vIBAN persistence and intent completion', async () => {
      const existing = {
        id: 77,
        iban: reserved.iban,
        bank: frickBank,
        currency: eur,
        userData,
        buy: null,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      } as VirtualIban;
      const intent = {
        id: 301,
        requestReference: 'dfx-viban-post-persist-crash',
        status: VirtualIbanIssuanceIntentStatus.ISSUING,
      } as VirtualIbanIssuanceIntent;
      manager.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(intent);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toBe(existing);

      expect(intent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: reserved.iban,
      });
      expect(manager.save).toHaveBeenCalledWith(intent);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it.each([VirtualIbanIssuanceIntentStatus.ISSUING, VirtualIbanIssuanceIntentStatus.FAILED])(
      'recovers an external match for %s without issuing another POST',
      async (status) => {
        const intent = {
          id: 301,
          requestReference: 'dfx-viban-recovery-reference',
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status,
        } as VirtualIbanIssuanceIntent;
        manager.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(intent)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);
        jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue({
          vban: reserved.iban,
        } as any);
        jest.spyOn(frickVibanProvider, 'adoptAndActivate').mockResolvedValue(reserved);

        await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toMatchObject({
          id: 501,
          iban: reserved.iban,
        });

        expect(frickVibanProvider.findRecoverableByDescription).toHaveBeenCalledWith(
          intent.requestReference,
          frickBank.iban,
        );
        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      },
    );

    it('fails closed on an unrecoverable ISSUING intent and never performs a second POST', async () => {
      const intent = {
        id: 301,
        requestReference: 'dfx-viban-uncertain-reference',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.ISSUING,
      } as VirtualIbanIssuanceIntent;
      manager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(intent);
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue(undefined);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(ServiceUnavailableException);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('rejects KYC below level 50 before acquiring the lock or calling Frick', async () => {
      await expect(
        service.getOrCreateFrickForUser({ ...userData, kycLevel: KycLevel.LEVEL_40 } as UserData, 'EUR'),
      ).rejects.toThrow('KycRequired');

      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });
  });

  describe('read helpers', () => {
    it('prefers Yapeal over Frick and then the smallest id for generic user-level lookups', async () => {
      jest.spyOn(virtualIbanRepo, 'find').mockResolvedValue([
        { id: 1, bank: { name: IbanBankName.FRICK } },
        { id: 9, bank: { name: IbanBankName.YAPEAL } },
        { id: 3, bank: { name: IbanBankName.YAPEAL } },
      ] as VirtualIban[]);

      await expect(service.getActiveForUserAndCurrency(userData, 'EUR')).resolves.toMatchObject({ id: 3 });
    });

    it('never returns an existing Frick vIBAN from the generic user-level lookup', async () => {
      jest
        .spyOn(virtualIbanRepo, 'find')
        .mockResolvedValue([{ id: 1, bank: { name: IbanBankName.FRICK } }] as VirtualIban[]);

      await expect(service.getActiveForUserAndCurrency(userData, 'EUR')).resolves.toBeNull();
    });

    it('getActiveForUserAndCurrency queries the repo with the expected filter', async () => {
      jest.spyOn(virtualIbanRepo, 'find').mockResolvedValue([]);

      await service.getActiveForUserAndCurrency(userData, 'CHF');

      expect(virtualIbanRepo.find).toHaveBeenCalledWith({
        where: {
          userData: { id: 7 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          buy: expect.anything(),
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
        relations: { bank: true },
        order: { id: 'ASC' },
      });
    });

    it('getByIban loads relations for userData, bank and buy', async () => {
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue(null);

      await service.getByIban('CH9300762011623852957');

      expect(virtualIbanRepo.findOneCached).toHaveBeenCalledWith('CH9300762011623852957', {
        where: { iban: 'CH9300762011623852957' },
        relations: { userData: true, bank: true, buy: true },
      });
    });

    it('countActiveForUser counts active rows for the user', async () => {
      jest.spyOn(virtualIbanRepo, 'countBy').mockResolvedValue(3);

      await expect(service.countActiveForUser(7)).resolves.toBe(3);
      expect(virtualIbanRepo.countBy).toHaveBeenCalledWith({
        userData: { id: 7 },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });
    });

    it('getBaseAccountIban returns the bank IBAN of the matching virtual IBAN', async () => {
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue({
        bank: { iban: 'CH9300762011623852957' },
      } as VirtualIban);

      await expect(service.getBaseAccountIban('CH4400762011623852958')).resolves.toBe('CH9300762011623852957');
    });

    it('getVirtualIbansForAccount queries by userData id', async () => {
      jest.spyOn(virtualIbanRepo, 'findCachedBy').mockResolvedValue([]);

      await service.getVirtualIbansForAccount(7);

      expect(virtualIbanRepo.findCachedBy).toHaveBeenCalledWith('user-7', { userData: { id: 7 } });
    });
  });
});
