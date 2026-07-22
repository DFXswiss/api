import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { BankService } from '../../bank/bank.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { YapealVibanProvider } from '../providers/yapeal-viban.provider';
import { VirtualIban, VirtualIbanStatus } from '../virtual-iban.entity';
import { VirtualIbanRepository } from '../virtual-iban.repository';
import { VirtualIbanService } from '../virtual-iban.service';

describe('VirtualIbanService', () => {
  let service: VirtualIbanService;
  let virtualIbanRepo: VirtualIbanRepository;
  let bankService: BankService;
  let fiatService: FiatService;
  let yapealVibanProvider: YapealVibanProvider;
  let frickVibanProvider: FrickVibanProvider;

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

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        VirtualIbanService,
        { provide: VirtualIbanRepository, useValue: virtualIbanRepo },
        { provide: BankService, useValue: bankService },
        { provide: FiatService, useValue: fiatService },
        { provide: YapealVibanProvider, useValue: yapealVibanProvider },
        { provide: FrickVibanProvider, useValue: frickVibanProvider },
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

    it('returns true for EUR when Frick is available and Yapeal is unavailable', () => {
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);

      expect(service.isUserEligible('EUR', userData)).toBe(true);
    });
  });

  describe('createForUser', () => {
    beforeEach(() => {
      jest.spyOn(virtualIbanRepo, 'findOneCachedBy').mockResolvedValue(null);
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
      jest.spyOn(virtualIbanRepo, 'findOneCachedBy').mockResolvedValue({ id: 99 } as VirtualIban);

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

    it('creates a EUR vIBAN via Frick and persists its providerAccountRef', async () => {
      const frickBank = { id: 3, iban: 'LI32088110105923K000C', receive: true, name: IbanBankName.FRICK };
      const eur = { id: 4, name: 'EUR' };
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(eur as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(frickBank as any);
      jest.spyOn(frickVibanProvider, 'reserveViban').mockResolvedValue({
        iban: 'LI75088110105923K000E',
        providerAccountRef: 'LI75088110105923K000E',
      });

      const saved = await service.createForUser(userData, 'EUR');

      expect(bankService.getBankInternal).toHaveBeenCalledWith(IbanBankName.FRICK, 'EUR');
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledWith(frickBank.iban);
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(virtualIbanRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          iban: 'LI75088110105923K000E',
          providerAccountRef: 'LI75088110105923K000E',
          status: VirtualIbanStatus.ACTIVE,
          active: true,
        }),
      );
      expect(saved.providerAccountRef).toBe('LI75088110105923K000E');
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
  });

  describe('read helpers', () => {
    it('getActiveForUserAndCurrency queries the repo with the expected filter', async () => {
      jest.spyOn(virtualIbanRepo, 'findOneCachedBy').mockResolvedValue(null);

      await service.getActiveForUserAndCurrency(userData, 'CHF');

      expect(virtualIbanRepo.findOneCachedBy).toHaveBeenCalledWith('7-CHF', {
        userData: { id: 7 },
        currency: { name: 'CHF' },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
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
