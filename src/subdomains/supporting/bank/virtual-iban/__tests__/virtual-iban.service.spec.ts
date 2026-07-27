import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataType, newDb } from 'pg-mem';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { DataSource, EntityManager, FindOperator, IsNull } from 'typeorm';
import { BankService } from '../../bank/bank.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { VibanAccountHolder, VibanNotCreatedError } from '../providers/viban-provider.interface';
import { YapealVibanProvider } from '../providers/yapeal-viban.provider';
import { VirtualIban, VirtualIbanStatus } from '../virtual-iban.entity';
import { VirtualIbanIssuanceEvent } from '../virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntent, VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent.entity';
import { VirtualIbanRepository } from '../virtual-iban.repository';
import { CREATE_PATH_REFERENCE_MARKER, MERGE_SUPERSEDED_MARKER, VirtualIbanService } from '../virtual-iban.service';

describe('VirtualIbanService', () => {
  let service: VirtualIbanService;
  let virtualIbanRepo: VirtualIbanRepository;
  let bankService: BankService;
  let fiatService: FiatService;
  let yapealVibanProvider: YapealVibanProvider;
  let frickVibanProvider: FrickVibanProvider;
  let dataSource: DataSource;
  let notificationService: NotificationService;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
    update: jest.Mock;
  };
  let transactionActive: boolean;

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
      accountHolder: VibanAccountHolder.CUSTOMER,
    });
    frickVibanProvider = createMock<FrickVibanProvider>({
      bankName: IbanBankName.FRICK,
      currencies: ['EUR'],
      accountHolder: VibanAccountHolder.DFX,
    });
    notificationService = createMock<NotificationService>();
    jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined as any);
    manager = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      query: jest.fn(),
      update: jest.fn(),
    };
    transactionActive = false;
    dataSource = createMock<DataSource>();
    (dataSource as unknown as { manager: typeof manager }).manager = manager;
    (dataSource.transaction as jest.Mock).mockImplementation(async (run: (manager: EntityManager) => unknown) => {
      transactionActive = true;
      try {
        return await run(manager as unknown as EntityManager);
      } finally {
        transactionActive = false;
      }
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
        { provide: DataSource, useValue: dataSource },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<VirtualIbanService>(VirtualIbanService);
  });

  describe('getAccountHolder', () => {
    it('returns CUSTOMER for Yapeal', () => {
      expect(service.getAccountHolder(IbanBankName.YAPEAL)).toBe(VibanAccountHolder.CUSTOMER);
    });

    it('returns DFX for Frick', () => {
      expect(service.getAccountHolder(IbanBankName.FRICK)).toBe(VibanAccountHolder.DFX);
    });

    it('throws for a bank name with no registered viban provider', () => {
      expect(() => service.getAccountHolder(IbanBankName.OLKY)).toThrow(
        `No viban provider registered for bank ${IbanBankName.OLKY}`,
      );
    });
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
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);
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
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue({ id: 99, bank } as VirtualIban);

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
    let currentIntent: VirtualIbanIssuanceIntent | null;
    let currentViban: VirtualIban | null;
    let auditEvents: VirtualIbanIssuanceEvent[];

    beforeEach(() => {
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(eur as any);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);
      jest.spyOn(frickVibanProvider, 'prepareVibanReservation').mockResolvedValue(undefined);
      currentIntent = null;
      currentViban = null;
      auditEvents = [];
      manager.query.mockImplementation(async (_sql, parameters) => {
        currentIntent ??= Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: parameters[0],
          userDataId: parameters[1],
          currencyId: parameters[2],
          bankId: parameters[3],
          status: parameters[4],
          externalIban: null,
          error: null,
        });
      });
      manager.findOne.mockImplementation(async (entity, options) => {
        if (entity === VirtualIbanIssuanceIntent) return currentIntent;
        if (entity === VirtualIban) {
          if (options.where.iban) return currentViban?.iban === options.where.iban ? currentViban : null;
          return currentViban?.active && currentViban.status === VirtualIbanStatus.ACTIVE ? currentViban : null;
        }
        return null;
      });
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => {
        if (value instanceof VirtualIbanIssuanceEvent) {
          value.id = 900 + auditEvents.length;
          auditEvents.push(value);
          return value;
        }
        if (value instanceof VirtualIbanIssuanceIntent) {
          currentIntent = value;
          return value;
        }
        if (value instanceof VirtualIban) {
          value.id = 501;
          currentViban = value;
          return value;
        }
        return value;
      });
    });

    it('preflights before the claim, performs external I/O without a DB transaction, and audits every transition', async () => {
      (virtualIbanRepo.invalidateCache as jest.Mock).mockImplementation(() => {
        expect(transactionActive).toBe(false);
      });
      jest.spyOn(frickVibanProvider, 'reserveViban').mockImplementation(async (_iban, description) => {
        expect(transactionActive).toBe(false);
        expect(description).toMatch(/^dfx-viban-[a-z0-9]{32}$/);
        return reserved;
      });
      (frickVibanProvider.prepareVibanReservation as jest.Mock).mockImplementation(async (_iban, description) => {
        expect(transactionActive).toBe(false);
        expect(description).toMatch(/^dfx-viban-[a-z0-9]{32}$/);
      });

      const result = await service.getOrCreateFrickForUser(userData, 'EUR');

      expect(result).toMatchObject({ id: 501, iban: reserved.iban, buy: null });
      expect(auditEvents).toEqual([
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        }),
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          nextStatus: VirtualIbanIssuanceIntentStatus.COMPLETED,
          nextVirtualIbanId: 501,
        }),
      ]);
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
      expect(manager.create).toHaveBeenCalledWith(
        VirtualIban,
        expect.objectContaining({ userData, bank: frickBank, currency: eur, buy: null }),
      );
    });

    it('leaves a Pending intent retryable when preflight fails before the claim', async () => {
      (frickVibanProvider.prepareVibanReservation as jest.Mock).mockRejectedValue(new Error('authorization failed'));

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(auditEvents).toEqual([]);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('maps a non-Error preflight rejection to the same 503 without claiming', async () => {
      (frickVibanProvider.prepareVibanReservation as jest.Mock).mockRejectedValue('raw-preflight-failure');

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('reconciles an existing active vIBAN and records the snapshot transition before updating it', async () => {
      currentViban = Object.assign(new VirtualIban(), {
        id: 77,
        iban: reserved.iban,
        bank: frickBank,
        currency: eur,
        userData,
        buy: null,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toBe(currentViban);

      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(auditEvents).toEqual([
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.COMPLETED,
          nextVirtualIbanId: 77,
        }),
      ]);
    });

    it.each([VirtualIbanIssuanceIntentStatus.IN_FLIGHT, VirtualIbanIssuanceIntentStatus.FAILED])(
      'recovers an external match for %s without issuing another POST',
      async (status) => {
        currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: 'dfx-viban-recovery-reference',
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status,
          externalIban: null,
          error: status === VirtualIbanIssuanceIntentStatus.FAILED ? 'ambiguous create failure' : null,
        });
        jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockImplementation(async () => {
          expect(transactionActive).toBe(false);
          return { vban: reserved.iban } as any;
        });
        jest.spyOn(frickVibanProvider, 'adoptAndActivate').mockResolvedValue(reserved);

        await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toMatchObject({
          id: 501,
          iban: reserved.iban,
        });

        expect(frickVibanProvider.findRecoverableByDescription).toHaveBeenCalledWith(
          currentIntent.requestReference,
          frickBank.iban,
        );
        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(auditEvents.at(-1)).toEqual(
          expect.objectContaining({
            previousStatus: status,
            nextStatus: VirtualIbanIssuanceIntentStatus.COMPLETED,
            previousError: status === VirtualIbanIssuanceIntentStatus.FAILED ? 'ambiguous create failure' : null,
            nextError: null,
          }),
        );
      },
    );

    it('fails closed on empty recovery for InFlight without rotating the requestReference', async () => {
      const oldReference = 'dfx-viban-uncertain-reference';
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: oldReference,
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue(undefined);
      jest.spyOn(frickVibanProvider, 'reserveViban').mockResolvedValue(reserved);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      // Request path must not reopen / rotate — reconciliation is the sole reopener.
      expect(currentIntent.requestReference).toBe(oldReference);
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(auditEvents).toEqual([]);
    });

    it('leaves InFlight unchanged (no rotate, no fail) when create fails and recovery listing proves empty', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue(new Error('socket closed'));
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue(undefined);

      const oldReferenceHolder: { value?: string } = {};
      (frickVibanProvider.prepareVibanReservation as jest.Mock).mockImplementation(async (_iban, description) => {
        oldReferenceHolder.value ??= description;
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      const oldReference = oldReferenceHolder.value;
      expect(oldReference).toMatch(/^dfx-viban-[a-z0-9]{32}$/);
      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        requestReference: oldReference,
        error: null,
      });
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
      // No transition event — intent left exactly as the create claim set it.
      expect(auditEvents).toEqual([
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        }),
      ]);
    });

    it('leaves InFlight unchanged when create fails with a non-Error and recovery is empty', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue('raw-create-failure');
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue(undefined);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
      expect(currentIntent.error).toBeNull();
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
    });

    it('recovers and finalizes when create fails but recovery listing finds the match', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue(new Error('socket closed'));
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue({
        vban: reserved.iban,
      } as any);
      jest.spyOn(frickVibanProvider, 'adoptAndActivate').mockResolvedValue(reserved);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toMatchObject({
        id: 501,
        iban: reserved.iban,
      });

      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
      expect(frickVibanProvider.findRecoverableByDescription).toHaveBeenCalled();
      expect(frickVibanProvider.adoptAndActivate).toHaveBeenCalled();
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(currentIntent.externalIban).toBe(reserved.iban);
    });

    it('fails the intent permanently with a classified error when create fails and recovery listing itself fails', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue(new Error('socket closed'));
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue(new Error('listing timeout'));

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        error: 'Bank Frick virtual IBAN create failed; recovery failed',
      });
      // Persisted error must not embed raw provider text.
      expect(currentIntent.error).not.toContain('socket closed');
      expect(currentIntent.error).not.toContain('listing timeout');
      expect(auditEvents.at(-1)).toEqual(
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
          nextError: 'Bank Frick virtual IBAN create failed; recovery failed',
        }),
      );
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
    });

    it('fails permanently when create and recovery both reject with non-Error values', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue('raw-create-failure');
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue('raw-recovery-failure');

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        error: 'Bank Frick virtual IBAN create failed; recovery failed',
      });
      expect(currentIntent.error).not.toContain('raw-create-failure');
      expect(currentIntent.error).not.toContain('raw-recovery-failure');
    });

    it('fails permanently when recovery rejects with a non-Error after an Error create failure', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockRejectedValue(new Error('socket closed'));
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue('raw-recovery-failure');

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        error: 'Bank Frick virtual IBAN create failed; recovery failed',
      });
    });

    it('never surfaces or persists provider ServiceUnavailableException detail (e.g. raw vban)', async () => {
      const leakyVban = 'LI99SENSITIVE000000001';
      jest
        .spyOn(frickVibanProvider, 'reserveViban')
        .mockRejectedValue(
          new ServiceUnavailableException(
            `Bank Frick virtual IBAN ${leakyVban} could not be activated (state: PREPARED)`,
          ),
        );
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue(new Error('listing timeout'));

      let caught: unknown;
      try {
        await service.getOrCreateFrickForUser(userData, 'EUR');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect((caught as ServiceUnavailableException).message).toBe(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      expect((caught as ServiceUnavailableException).message).not.toContain(leakyVban);
      expect(String(caught)).not.toContain(leakyVban);
      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        error: 'Bank Frick virtual IBAN create failed; recovery failed',
      });
      expect(currentIntent.error).not.toContain(leakyVban);
    });

    it.each([VirtualIbanIssuanceIntentStatus.IN_FLIGHT, VirtualIbanIssuanceIntentStatus.FAILED])(
      'fails closed on empty recovery for stuck %s without rotating or re-issuing',
      async (status) => {
        const oldReference = 'dfx-viban-stuck-reference-000000000001';
        currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: oldReference,
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status,
          externalIban: null,
          error: status === VirtualIbanIssuanceIntentStatus.FAILED ? 'previous ambiguous failure' : null,
        });
        jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockResolvedValue(undefined);
        jest.spyOn(frickVibanProvider, 'reserveViban').mockResolvedValue(reserved);

        await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
          QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
        );

        expect(currentIntent.requestReference).toBe(oldReference);
        expect(currentIntent.status).toBe(status);
        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(auditEvents).toEqual([]);
      },
    );

    it('still 503s when resolveExistingFrickIntent recovery listing itself fails', async () => {
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-listing-fails-reference',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        externalIban: null,
        error: 'previous ambiguous failure',
      });
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue(new Error('Frick listing 5xx'));

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
    });

    it('still 503s when resolveExisting recovery rejects with a non-Error value', async () => {
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-listing-fails-nonerror-ref',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      jest.spyOn(frickVibanProvider, 'findRecoverableByDescription').mockRejectedValue('raw-listing-failure');

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
    });

    it('returns a definitely rejected create to Pending with a classified error and permits one fresh retry', async () => {
      jest
        .spyOn(frickVibanProvider, 'reserveViban')
        .mockRejectedValueOnce(new VibanNotCreatedError('Bank Frick virtual IBAN create rejected'))
        .mockResolvedValueOnce(reserved);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      expect(currentIntent).toMatchObject({
        status: VirtualIbanIssuanceIntentStatus.PENDING,
        error: 'Bank Frick virtual IBAN create rejected',
      });
      expect(auditEvents.at(-1)).toEqual(
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextError: 'Bank Frick virtual IBAN create rejected',
        }),
      );

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).resolves.toMatchObject({ iban: reserved.iban });
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(2);
      expect(auditEvents).toContainEqual(
        expect.objectContaining({
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          previousError: 'Bank Frick virtual IBAN create rejected',
          nextError: null,
        }),
      );
    });

    it('rejects reactivation of an inactive local vIBAN without overwriting its history', async () => {
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-completed-reference',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: reserved.iban,
        error: null,
      });
      currentViban = Object.assign(new VirtualIban(), {
        id: 77,
        iban: reserved.iban,
        bank: frickBank,
        currency: eur,
        userData,
        buy: null,
        active: false,
        status: VirtualIbanStatus.DEACTIVATED,
        deactivatedAt: new Date('2026-07-01T00:00:00Z'),
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(currentViban).toMatchObject({ active: false, status: VirtualIbanStatus.DEACTIVATED });
      expect(manager.save).not.toHaveBeenCalledWith(currentViban);
    });

    it('rejects KYC below level 50 before opening a transaction or calling Frick', async () => {
      await expect(
        service.getOrCreateFrickForUser({ ...userData, kycLevel: KycLevel.LEVEL_40 } as UserData, 'EUR'),
      ).rejects.toThrow(QuoteError.KYC_REQUIRED);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('rejects non-EUR currencies before opening a transaction or calling Frick', async () => {
      await expect(service.getOrCreateFrickForUser(userData, 'CHF')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(frickVibanProvider.isAvailable).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when Frick vIBAN service is not available', async () => {
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(frickVibanProvider.prepareVibanReservation).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('rejects when EUR fiat is missing before any Frick I/O', async () => {
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(undefined);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(QuoteError.CURRENCY_UNSUPPORTED);
      expect(bankService.getBankInternal).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects when Frick receive bank is missing before any Frick I/O', async () => {
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue({ ...frickBank, receive: false } as any);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.NO_BANK_AVAILABLE_FOR_THIS_CURRENCY,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(frickVibanProvider.prepareVibanReservation).not.toHaveBeenCalled();
    });

    it('fails closed when intent.externalIban conflicts with an already-active personal IBAN', async () => {
      currentViban = Object.assign(new VirtualIban(), {
        id: 77,
        iban: reserved.iban,
        bank: frickBank,
        currency: eur,
        userData,
        buy: null,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-conflict-ref-00000000000001',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
        externalIban: 'LI99OTHER00000000001',
        error: null,
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(auditEvents).toEqual([]);
    });

    it('fails closed when the intent row cannot be created/read after insert', async () => {
      manager.findOne.mockImplementation(async (entity) => {
        if (entity === VirtualIbanIssuanceIntent) return null;
        return null;
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(frickVibanProvider.prepareVibanReservation).not.toHaveBeenCalled();
    });

    it('fails closed when resolveExisting sees an unexpected terminal-less status', async () => {
      // COMPLETED without externalIban is not a recoverable request-path state.
      currentIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-unexpected-status-ref-000001',
        userDataId: userData.id,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: null,
        error: null,
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );
      expect(frickVibanProvider.findRecoverableByDescription).not.toHaveBeenCalled();
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    // These tests run against a mocked transaction layer (`dataSource.transaction` / `manager` are
    // jest mocks, not a real database). Passing proves the sequencing/polling logic is correct but
    // does NOT exercise real DB lock behavior (e.g. `pessimistic_write` row-lock contention under
    // concurrent connections) — accepted standard for this suite.
    describe('losing parallel claimant wait (F3)', () => {
      afterEach(() => {
        jest.useRealTimers();
      });

      it('returns the completed VirtualIban when the winner finishes within the poll window', async () => {
        jest.useFakeTimers();

        // Parallel winner claims during preflight so this request loses claimPendingFrickIntent.
        (frickVibanProvider.prepareVibanReservation as jest.Mock).mockImplementation(async () => {
          currentIntent!.status = VirtualIbanIssuanceIntentStatus.IN_FLIGHT;
        });

        // Without the wait, recovery would run; winner completes mid-poll instead.
        jest
          .spyOn(frickVibanProvider, 'findRecoverableByDescription')
          .mockRejectedValue(new Error('should not reach recovery if winner completes'));

        let pollCount = 0;
        manager.findOne.mockImplementation(async (entity, options) => {
          if (entity === VirtualIbanIssuanceIntent) {
            // Polls happen outside any transaction (waitForFrickClaimWinner).
            if (!transactionActive) {
              pollCount += 1;
              if (pollCount >= 2) {
                Object.assign(currentIntent!, {
                  status: VirtualIbanIssuanceIntentStatus.COMPLETED,
                  externalIban: reserved.iban,
                  error: null,
                });
                // Winner already persisted the local row; by-iban finalize must find it.
                currentViban ??= Object.assign(new VirtualIban(), {
                  id: 501,
                  iban: reserved.iban,
                  bank: frickBank,
                  currency: eur,
                  userData,
                  buy: null,
                  active: true,
                  status: VirtualIbanStatus.ACTIVE,
                  providerAccountRef: reserved.providerAccountRef,
                });
              }
            }
            return currentIntent;
          }
          if (entity === VirtualIban) {
            if (options?.where?.iban) {
              return currentViban?.iban === options.where.iban ? currentViban : null;
            }
            return currentViban?.active && currentViban.status === VirtualIbanStatus.ACTIVE ? currentViban : null;
          }
          return null;
        });

        const resultPromise = service.getOrCreateFrickForUser(userData, 'EUR');
        // Drive the bounded poll window without real wall-clock sleep.
        await jest.advanceTimersByTimeAsync(3000);
        const result = await resultPromise;

        expect(result).toMatchObject({ iban: reserved.iban });
        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(frickVibanProvider.findRecoverableByDescription).not.toHaveBeenCalled();
        expect(pollCount).toBeGreaterThanOrEqual(2);
      });

      it('falls through to recovery when the claim wait window elapses without COMPLETED', async () => {
        jest.useFakeTimers();

        (frickVibanProvider.prepareVibanReservation as jest.Mock).mockImplementation(async () => {
          currentIntent!.status = VirtualIbanIssuanceIntentStatus.IN_FLIGHT;
        });

        jest
          .spyOn(frickVibanProvider, 'findRecoverableByDescription')
          .mockRejectedValue(new Error('listing still unavailable'));

        const resultPromise = service.getOrCreateFrickForUser(userData, 'EUR');
        const expectation = expect(resultPromise).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
        await jest.advanceTimersByTimeAsync(3000);
        await expectation;

        expect(frickVibanProvider.findRecoverableByDescription).toHaveBeenCalled();
        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
      });

      it('fails closed when the intent row disappears during the claim wait poll', async () => {
        jest.useFakeTimers();

        (frickVibanProvider.prepareVibanReservation as jest.Mock).mockImplementation(async () => {
          currentIntent!.status = VirtualIbanIssuanceIntentStatus.IN_FLIGHT;
        });

        manager.findOne.mockImplementation(async (entity) => {
          if (entity === VirtualIbanIssuanceIntent) {
            // Inside claim transaction: still return the row so claim can lose.
            if (transactionActive) return currentIntent;
            // Outside transaction: wait poll cannot find the intent.
            return null;
          }
          return null;
        });

        const resultPromise = service.getOrCreateFrickForUser(userData, 'EUR');
        const expectation = expect(resultPromise).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
        await jest.advanceTimersByTimeAsync(500);
        await expectation;

        expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
        expect(frickVibanProvider.findRecoverableByDescription).not.toHaveBeenCalled();
      });
    });
  });

  describe('read helpers', () => {
    it('returns the first generic user-level vIBAN selected by the repository', async () => {
      const selected = { id: 3, bank: { name: IbanBankName.YAPEAL } } as VirtualIban;
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(selected);

      await expect(service.getActiveForUserAndCurrency(userData, 'EUR')).resolves.toBe(selected);
    });

    it('never returns an existing Frick vIBAN from the generic user-level lookup', async () => {
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getActiveForUserAndCurrency(userData, 'EUR')).resolves.toBeNull();
    });

    it('getActiveForUserAndCurrency queries the repo with the expected filter and deterministic order', async () => {
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);

      await service.getActiveForUserAndCurrency(userData, 'CHF');

      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
        where: {
          userData: { id: 7 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          buy: IsNull(),
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
        relations: { bank: true },
        order: { id: 'ASC' },
      });
    });

    it('does not treat a buy-bound personal IBAN as a user-level match', async () => {
      const buyBound = {
        id: 88,
        iban: 'CH4400762011623852959',
        buy: { id: 55 },
        userData: { id: 7 },
        currency: { name: 'CHF' },
        bank: { name: IbanBankName.YAPEAL },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      } as VirtualIban;

      jest.spyOn(virtualIbanRepo, 'findOne').mockImplementation(async (options: any) => {
        const buyWhere = options?.where?.buy;
        // Simulate TypeORM: buy: IsNull() excludes rows with a set buy relation.
        if (buyWhere instanceof FindOperator && buyWhere.type === 'isNull') return null;
        // If the IsNull filter were removed/loosened, the buy-bound row would match.
        return buyBound;
      });

      await expect(service.getActiveForUserAndCurrency(userData, 'CHF')).resolves.toBeNull();
      expect(virtualIbanRepo.findOne).toHaveBeenCalled();
    });

    it('getActiveForBuyAndCurrency queries the buy-bound pool (buy id, not IsNull)', async () => {
      jest.spyOn(virtualIbanRepo, 'findOneCached').mockResolvedValue(null);

      await service.getActiveForBuyAndCurrency(55, 'CHF');

      expect(virtualIbanRepo.findOneCached).toHaveBeenCalledWith('buy-55-CHF', {
        where: {
          buy: { id: 55 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
      });
      // Complementary to user-level buy: IsNull() — buy-bound lookup must not use IsNull.
      const where = (virtualIbanRepo.findOneCached as jest.Mock).mock.calls[0][1].where;
      expect(where.buy).toEqual({ id: 55 });
      expect(where.buy).not.toBeInstanceOf(FindOperator);
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

    it('getByIdForUser queries by id and userData id with full relations', async () => {
      const row = { id: 9 } as VirtualIban;
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(row);

      await expect(service.getByIdForUser(9, 7)).resolves.toBe(row);
      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
        where: { id: 9, userData: { id: 7 } },
        relations: { bank: true, currency: true, userData: true, buy: true },
      });
    });

    it('getVirtualIbanByKey builds a joined query for the given key/value', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 1 } as VirtualIban),
      };
      jest.spyOn(virtualIbanRepo, 'createQueryBuilder').mockReturnValue(qb as any);

      await expect(service.getVirtualIbanByKey('iban', 'CH4400762011623852958')).resolves.toEqual({ id: 1 });
      expect(virtualIbanRepo.createQueryBuilder).toHaveBeenCalledWith('virtualIban');
      expect(qb.where).toHaveBeenCalledWith('virtualIban.iban = :param', { param: 'CH4400762011623852958' });
    });

    it('getVirtualIbanByKey keeps dotted keys as-is for nested relation filters', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      jest.spyOn(virtualIbanRepo, 'createQueryBuilder').mockReturnValue(qb as any);

      await service.getVirtualIbanByKey('userData.id', 7);
      expect(qb.where).toHaveBeenCalledWith('userData.id = :param', { param: 7 });
    });
  });

  describe('deactivateVirtualIbanLocked', () => {
    const frickBank = { id: 10, name: IbanBankName.FRICK };
    const eur = { id: 1, name: 'EUR' };

    const deactivateLocked = (viban: VirtualIban): Promise<VirtualIban> =>
      dataSource.transaction((m) => (service as any).deactivateVirtualIbanLocked(m, viban));

    beforeEach(() => {
      manager.findOne.mockResolvedValue(null);
      manager.create.mockImplementation((_entity, data) => Object.assign({}, data));
      manager.save.mockImplementation(async (value) => value);
    });

    it('sets deactivated fields via transaction save', async () => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: 7 },
        currency: eur,
        bank: frickBank,
      });

      const result = await deactivateLocked(viban);

      expect(result.active).toBe(false);
      expect(result.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(result.deactivatedAt).toBeInstanceOf(Date);
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledWith(viban);
      expect(virtualIbanRepo.save).not.toHaveBeenCalled();
    });

    it('resets a matching Completed Frick intent to Pending with fresh reference and null externalIban', async () => {
      const iban = 'LI21088110100111K000E';
      const oldReference = 'dfx-viban-completed-old-ref';
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: 7 },
        currency: eur,
        bank: frickBank,
      });
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: 7,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: iban,
        error: null,
        requestReference: oldReference,
      });
      manager.findOne.mockImplementation(
        async (entity, options: { where?: { userDataId?: number; iban?: string } }) => {
          if (entity === VirtualIbanIssuanceIntent && options?.where?.userDataId === 7) return intent;
          if (entity === VirtualIban && options?.where?.iban === iban) return viban;
          return null;
        },
      );

      await deactivateLocked(viban);

      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(intent.externalIban).toBeNull();
      expect(intent.requestReference).not.toBe(oldReference);
      expect(intent.requestReference).toMatch(/^dfx-viban-/);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: intent.id,
          previousStatus: VirtualIbanIssuanceIntentStatus.COMPLETED,
          nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          previousVirtualIbanId: 42,
          nextVirtualIbanId: null,
        }),
      );
    });

    it('does not touch intent when COMPLETED externalIban mismatches the deactivated vIBAN', async () => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: 7 },
        currency: eur,
        bank: frickBank,
      });
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: 7,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: 'LI21088110100111K000Z',
        error: null,
        requestReference: 'dfx-viban-other-ref',
      });
      manager.findOne.mockImplementation(async (entity, options: { where?: { userDataId?: number } }) => {
        if (entity === VirtualIbanIssuanceIntent && options?.where?.userDataId === 7) return intent;
        return null;
      });

      await deactivateLocked(viban);

      expect(viban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(intent.externalIban).toBe('LI21088110100111K000Z');
      expect(intent.requestReference).toBe('dfx-viban-other-ref');
      // Only the vIBAN row is saved — no intent/event transition save for the intent entity itself
      // beyond the viban; event create/save would only run on transition.
      expect(manager.save).toHaveBeenCalledWith(viban);
      expect(manager.save).not.toHaveBeenCalledWith(expect.objectContaining({ intentId: intent.id }));
    });

    it.each([
      VirtualIbanIssuanceIntentStatus.PENDING,
      VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      VirtualIbanIssuanceIntentStatus.FAILED,
    ])('leaves non-terminal %s intent unchanged on deactivation', async (status) => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: 7 },
        currency: eur,
        bank: frickBank,
      });
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: 7,
        currencyId: eur.id,
        bankId: frickBank.id,
        status,
        externalIban: null,
        error: status === VirtualIbanIssuanceIntentStatus.FAILED ? 'previous' : null,
        requestReference: 'dfx-viban-nonterminal-ref',
      });
      manager.findOne.mockImplementation(async (entity, options: { where?: { userDataId?: number } }) => {
        if (entity === VirtualIbanIssuanceIntent && options?.where?.userDataId === 7) return intent;
        return null;
      });

      await deactivateLocked(viban);

      expect(viban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(intent.status).toBe(status);
      expect(intent.requestReference).toBe('dfx-viban-nonterminal-ref');
      expect(manager.save).toHaveBeenCalledWith(viban);
      expect(manager.save).not.toHaveBeenCalledWith(expect.objectContaining({ intentId: intent.id }));
    });

    it('is a no-op for issuance intent when none exists (e.g. Yapeal-issued vIBAN)', async () => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'CH4400762011623852958',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: 7 },
        currency: { id: 2, name: 'CHF' },
        bank: { id: 11, name: IbanBankName.YAPEAL },
      });
      manager.findOne.mockResolvedValue(null);

      await deactivateLocked(viban);

      expect(viban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: { userDataId: 7, currencyId: 2, bankId: 11 },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.save).toHaveBeenCalledWith(viban);
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('reloads ownership relations when the caller did not preload userData/currency/bank', async () => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        // relations intentionally omitted — deactivation must re-read under the lock
      });
      const owned = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        userData: { id: 7 },
        currency: eur,
        bank: frickBank,
      });
      manager.findOne.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return owned;
        return null;
      });

      await deactivateLocked(viban);

      expect(viban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIban, {
        where: { id: 42 },
        relations: { userData: true, currency: true, bank: true },
      });
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: { userDataId: 7, currencyId: eur.id, bankId: frickBank.id },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('fails closed when ownership relations cannot be resolved during deactivation', async () => {
      const viban = Object.assign(new VirtualIban(), {
        id: 42,
        iban: 'LI21088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });
      manager.findOne.mockResolvedValue(null);

      await expect(deactivateLocked(viban)).rejects.toThrow(
        'Virtual IBAN ownership relations missing during deactivation (virtualIbanId=42)',
      );
    });
  });

  describe('resolveIssuanceIntentsForMergeLocked', () => {
    const masterId = 1000;
    const slaveId = 2000;
    const currencyId = 1;
    const bankId = 10;

    const expectedMergeFailMessage = (requestReference: string): string =>
      (
        `Superseded by account merge of userData ${slaveId} into ${masterId}; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${requestReference}`
      ).slice(0, 2000);

    const resolveLocked = (): Promise<void> =>
      dataSource.transaction((m) => (service as any).resolveIssuanceIntentsForMergeLocked(m, masterId, slaveId));

    it('reassigns slave intent to master when master has none for that currency+bank', async () => {
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId,
        bankId,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
        externalIban: null,
        error: null,
      });
      manager.find.mockResolvedValue([slaveIntent]);
      manager.findOne.mockResolvedValue(null); // no master intent
      manager.update.mockResolvedValue({ affected: 1 });

      await resolveLocked();

      expect(manager.find).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: { userDataId: slaveId },
      });
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: { userDataId: masterId, currencyId, bankId },
      });
      expect(manager.update).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, slaveIntent.id, {
        userDataId: masterId,
      });
      expect(slaveIntent.userDataId).toBe(masterId);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it.each([
      VirtualIbanIssuanceIntentStatus.PENDING,
      VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      VirtualIbanIssuanceIntentStatus.FAILED,
    ])('fails slave %s intent when master already has the same currency+bank pair', async (slaveStatus) => {
      const slaveRef = 'dfx-viban-slave-ref';
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId,
        bankId,
        status: slaveStatus,
        externalIban: null,
        error: slaveStatus === VirtualIbanIssuanceIntentStatus.FAILED ? 'previous failure' : null,
        requestReference: slaveRef,
      });
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId,
        bankId,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
        externalIban: null,
        error: null,
        requestReference: 'dfx-viban-master-ref',
      });
      manager.find.mockResolvedValue([slaveIntent]);
      manager.findOne.mockImplementation(async (entity, options: { where?: { id?: number; userDataId?: number } }) => {
        if (entity !== VirtualIbanIssuanceIntent) return null;
        if (options?.where?.id === slaveIntent.id) return slaveIntent;
        if (options?.where?.userDataId === masterId) return masterIntent;
        return null;
      });
      manager.create.mockImplementation((_entity, data) => Object.assign({}, data));
      manager.save.mockImplementation(async (value) => value);
      manager.update.mockResolvedValue({ affected: 0 });

      await resolveLocked();

      const expectedError = expectedMergeFailMessage(slaveRef);
      expect(manager.update).not.toHaveBeenCalled();
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntent.error).toBe(expectedError);
      expect(slaveIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(slaveIntent.error).toContain(`${CREATE_PATH_REFERENCE_MARKER}${slaveRef}`);
      expect(slaveIntent.userDataId).toBe(slaveId);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: slaveIntent.id,
          previousStatus: slaveStatus,
          nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
          nextError: expectedError,
        }),
      );
    });

    it('leaves COMPLETED slave intent untouched even when master has the same pair', async () => {
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId,
        bankId,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: 'LI21088110100111K000E',
        error: null,
      });
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId,
        bankId,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
      });
      manager.find.mockResolvedValue([slaveIntent]);
      manager.findOne.mockResolvedValue(masterIntent);

      await resolveLocked();

      expect(manager.update).not.toHaveBeenCalled();
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(slaveIntent.userDataId).toBe(slaveId);
      expect(slaveIntent.externalIban).toBe('LI21088110100111K000E');
    });
  });

  describe('mergeUserLevelVirtualIbans', () => {
    const masterId = 1000;
    const slaveId = 2000;
    const eur = { id: 1, name: 'EUR' };
    const frickBank = { id: 10, name: IbanBankName.FRICK };
    const chf = { id: 2, name: 'CHF' };

    beforeEach(() => {
      manager.find.mockResolvedValue([]);
      manager.findOne.mockResolvedValue(null);
      manager.create.mockImplementation((_entity, data) => Object.assign({}, data));
      manager.save.mockImplementation(async (value) => value);
      manager.update.mockResolvedValue({ affected: 0 });
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);
    });

    it('runs all deactivations, winner ownership, and intent reconcile in a single transaction', async () => {
      const winnerA = Object.assign(new VirtualIban(), {
        id: 11,
        iban: 'LI21088110100111K011E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const loserA = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      const winnerB = Object.assign(new VirtualIban(), {
        id: 12,
        iban: 'LI21088110100111K012E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: chf,
        bank: frickBank,
      });
      const loserB = Object.assign(new VirtualIban(), {
        id: 33,
        iban: 'LI21088110100111K033E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: chf,
        bank: frickBank,
      });
      // Real intent pair for EUR: master Completed on winner, slave Pending → merge-supersede slave
      // in the same transaction as deactivation + winner ownership. CHF has no intents (no-op path).
      const masterIntentEur = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: winnerA.iban,
        requestReference: 'dfx-viban-master-eur-completed',
        error: null,
      });
      const slaveRefEur = 'dfx-viban-slave-eur-pending';
      const slaveIntentEur = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.PENDING,
        externalIban: null,
        requestReference: slaveRefEur,
        error: null,
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntentEur.id, masterIntentEur],
        [slaveIntentEur.id, slaveIntentEur],
      ]);
      const managersSeen: EntityManager[] = [];
      (dataSource.transaction as jest.Mock).mockImplementation(async (run: (m: EntityManager) => unknown) => {
        managersSeen.push(manager as unknown as EntityManager);
        return run(manager as unknown as EntityManager);
      });
      manager.find.mockImplementation(async (entity, options: { where?: unknown }) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return [masterIntentEur, slaveIntentEur].filter((i) => i.userDataId === slaveId);
        }
        if (entity === VirtualIban) {
          const where = options?.where as Array<{ currency?: { id: number } }> | undefined;
          const currencyId = Array.isArray(where) ? where[0]?.currency?.id : undefined;
          if (currencyId === eur.id) return [winnerA];
          if (currencyId === chf.id) return [winnerB];
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (
          entity,
          options: {
            where?: {
              id?: number;
              userDataId?: number;
              currencyId?: number;
              bankId?: number;
              iban?: string;
            };
            lock?: unknown;
          },
        ) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId != null) {
              return (
                [masterIntentEur, slaveIntentEur].find(
                  (i) =>
                    i.userDataId === options.where?.userDataId &&
                    (options.where.currencyId == null || i.currencyId === options.where.currencyId) &&
                    (options.where.bankId == null || i.bankId === options.where.bankId),
                ) ?? null
              );
            }
          }
          return null;
        },
      );
      manager.update.mockImplementation(async (entity, id, values: Record<string, unknown>) => {
        if (entity === VirtualIbanIssuanceIntent) {
          const intent = intentsById.get(id as number);
          if (intent && values.userDataId != null) intent.userDataId = values.userDataId as number;
        }
        return { affected: 1 };
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: loserA, reason: 'merged A' },
        { virtualIban: loserB, reason: 'merged B' },
      ]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(managersSeen).toHaveLength(1);
      // Deactivations of both losers.
      expect(loserA.active).toBe(false);
      expect(loserB.active).toBe(false);
      expect(loserA.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(loserB.status).toBe(VirtualIbanStatus.DEACTIVATED);
      // Winner already on master — no ownership update for the vIBAN rows themselves.
      expect(manager.update).not.toHaveBeenCalledWith(
        VirtualIban,
        expect.anything(),
        expect.objectContaining({ userData: expect.anything() }),
      );
      // Intent reconcile (EUR pair) in the same transaction: slave Pending → permanently merge-failed;
      // master Completed winner stays Completed under master. CHF had no intents (no-op).
      expect(slaveIntentEur.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntentEur.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(slaveIntentEur.error).toContain(`${CREATE_PATH_REFERENCE_MARKER}${slaveRefEur}`);
      expect(slaveIntentEur.userDataId).toBe(slaveId);
      expect(masterIntentEur.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(masterIntentEur.userDataId).toBe(masterId);
      expect(masterIntentEur.externalIban).toBe(winnerA.iban);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: slaveIntentEur.id,
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        }),
      );
      expect(virtualIbanRepo.invalidateCache).toHaveBeenCalled();
    });

    it('B1 slave-wins: reassigns winner ownership, fails master intent, keeps slave Completed under master', async () => {
      const masterIban = 'LI21088110100111K0MAE';
      const slaveIban = 'LI21088110100111K0SLE';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 30,
        iban: masterIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 20,
        iban: slaveIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: masterIban,
        requestReference: 'dfx-viban-master-completed',
        error: null,
      });
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: slaveIban,
        requestReference: 'dfx-viban-slave-completed',
        error: null,
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntent.id, masterIntent],
        [slaveIntent.id, slaveIntent],
      ]);

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [slaveViban];
        if (entity === VirtualIbanIssuanceIntent) {
          // resolveIssuanceIntentsForMergeLocked slave scan — after pair resolve, winner is on master
          // and loser is Failed (possibly relocated onto slaveId by unique-index park-swap).
          return [masterIntent, slaveIntent].filter((i) => i.userDataId === slaveId);
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (
          entity,
          options: {
            where?: {
              id?: number;
              userDataId?: number;
              currencyId?: number;
              bankId?: number;
              iban?: string;
            };
          },
        ) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId === masterId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === masterId) ?? null;
            }
            if (options?.where?.userDataId === slaveId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === slaveId) ?? null;
            }
            if (options?.where?.userDataId != null && options.where.userDataId < 0) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === options.where?.userDataId) ?? null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban != null) {
            if (options.where.iban === masterIban) return masterViban;
            if (options.where.iban === slaveIban) return slaveViban;
          }
          return null;
        },
      );
      manager.update.mockImplementation(async (entity, id, values: Record<string, unknown>) => {
        if (entity === VirtualIbanIssuanceIntent) {
          const intent = intentsById.get(id as number);
          if (intent && values.userDataId != null) intent.userDataId = values.userDataId as number;
        }
        if (entity === VirtualIban && id === slaveViban.id) {
          const userData = values.userData as { id: number } | undefined;
          if (userData?.id != null) slaveViban.userData = { id: userData.id } as UserData;
        }
        return { affected: 1 };
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: masterViban, reason: `Merged into virtual IBAN ${slaveViban.id}` },
      ]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(masterViban.active).toBe(false);
      expect(masterViban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(slaveViban.active).toBe(true);

      // Winner (ex-slave) ownership move must be a real DB update onto masterId.
      expect(manager.update).toHaveBeenCalledWith(VirtualIban, slaveViban.id, {
        userData: { id: masterId },
      });

      // Master's own pre-merge intent was reopened by deactivation then permanently merge-failed.
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(masterIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(masterIntent.error).toContain(CREATE_PATH_REFERENCE_MARKER);
      expect(masterIntent.status).not.toBe(VirtualIbanIssuanceIntentStatus.PENDING);

      // Winner-side (ex-slave) intent stays Completed on the winning IBAN under masterId.
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(slaveIntent.externalIban).toBe(slaveIban);
      expect(slaveIntent.userDataId).toBe(masterId);

      // Unique index (userDataId, currencyId, bankId): the failed loser row is relocated onto the
      // winner's previous owner so the Completed winner can occupy masterId.
      expect(masterIntent.userDataId).toBe(slaveId);

      // No Completed intent still points at the deactivated (loser) IBAN.
      for (const intent of [masterIntent, slaveIntent]) {
        if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) {
          expect(intent.externalIban).not.toBe(masterIban);
          expect(intent.externalIban).toBe(slaveIban);
        }
      }
    });

    it('B1 master-wins: fails slave intent as merge-superseded, keeps master Completed under master', async () => {
      const masterIban = 'LI21088110100111K0MAE';
      const slaveIban = 'LI21088110100111K0SLE';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 11,
        iban: masterIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 22,
        iban: slaveIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: masterIban,
        requestReference: 'dfx-viban-master-completed',
        error: null,
      });
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: slaveIban,
        requestReference: 'dfx-viban-slave-completed',
        error: null,
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntent.id, masterIntent],
        [slaveIntent.id, slaveIntent],
      ]);

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [masterViban];
        if (entity === VirtualIbanIssuanceIntent) {
          return [masterIntent, slaveIntent].filter((i) => i.userDataId === slaveId);
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (
          entity,
          options: {
            where?: {
              id?: number;
              userDataId?: number;
              iban?: string;
            };
          },
        ) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId === masterId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === masterId) ?? null;
            }
            if (options?.where?.userDataId === slaveId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === slaveId) ?? null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban != null) {
            if (options.where.iban === masterIban) return masterViban;
            if (options.where.iban === slaveIban) return slaveViban;
          }
          return null;
        },
      );
      manager.update.mockImplementation(async (entity, id, values: Record<string, unknown>) => {
        if (entity === VirtualIbanIssuanceIntent) {
          const intent = intentsById.get(id as number);
          if (intent && values.userDataId != null) intent.userDataId = values.userDataId as number;
        }
        return { affected: 1 };
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` },
      ]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(slaveViban.active).toBe(false);
      expect(slaveViban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(masterViban.active).toBe(true);

      // Winner already owned by master — no VirtualIban ownership update required.
      expect(manager.update).not.toHaveBeenCalledWith(
        VirtualIban,
        masterViban.id,
        expect.objectContaining({ userData: expect.anything() }),
      );

      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(masterIntent.externalIban).toBe(masterIban);
      expect(masterIntent.userDataId).toBe(masterId);

      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(slaveIntent.error).toContain(CREATE_PATH_REFERENCE_MARKER);
      expect(slaveIntent.userDataId).toBe(slaveId);

      for (const intent of [masterIntent, slaveIntent]) {
        if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) {
          expect(intent.externalIban).not.toBe(slaveIban);
          expect(intent.externalIban).toBe(masterIban);
        }
      }
    });

    it('fails closed when no surviving winner exists for a deduped pair', async () => {
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      manager.find.mockResolvedValue([]); // no winner

      await expect(
        service.mergeUserLevelVirtualIbans(masterId, slaveId, [{ virtualIban: loser, reason: 'merged' }]),
      ).rejects.toThrow(
        `Account merge vIBAN dedup expected exactly one surviving winner ` +
          `(currencyId=${eur.id}, bankId=${frickBank.id}, masterId=${masterId}, slaveId=${slaveId}, found=0)`,
      );
    });

    it('fails closed when more than one surviving winner exists for a deduped pair', async () => {
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      manager.find.mockResolvedValue([
        Object.assign(new VirtualIban(), { id: 11, active: true, status: VirtualIbanStatus.ACTIVE }),
        Object.assign(new VirtualIban(), { id: 12, active: true, status: VirtualIbanStatus.ACTIVE }),
      ]);

      await expect(
        service.mergeUserLevelVirtualIbans(masterId, slaveId, [{ virtualIban: loser, reason: 'merged' }]),
      ).rejects.toThrow(
        `Account merge vIBAN dedup expected exactly one surviving winner ` +
          `(currencyId=${eur.id}, bankId=${frickBank.id}, masterId=${masterId}, slaveId=${slaveId}, found=2)`,
      );
    });

    it('reloads currency/bank from the transactional manager when the loser relations are not preloaded', async () => {
      const winner = Object.assign(new VirtualIban(), {
        id: 11,
        iban: 'LI21088110100111K011E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        // currency/bank intentionally omitted
      });
      const ownedLoser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [winner];
        return [];
      });
      manager.findOne.mockImplementation(async (entity, options: { where?: { id?: number } }) => {
        if (entity === VirtualIban && options?.where?.id === 22) return ownedLoser;
        return null;
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [{ virtualIban: loser, reason: 'merged' }]);

      expect(manager.findOne).toHaveBeenCalledWith(VirtualIban, {
        where: { id: 22 },
        relations: { currency: true, bank: true },
      });
      expect(loser.status).toBe(VirtualIbanStatus.DEACTIVATED);
    });

    it('fails closed when currency/bank cannot be resolved for a loser during merge dedup', async () => {
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        // currency/bank intentionally omitted
      });
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.mergeUserLevelVirtualIbans(masterId, slaveId, [{ virtualIban: loser, reason: 'merged' }]),
      ).rejects.toThrow(
        `Virtual IBAN currency/bank missing during merge dedup (virtualIbanId=22, masterId=${masterId}, slaveId=${slaveId})`,
      );
    });

    it('is a no-op for Frick intents when none exist for the pair (e.g. Yapeal-issued winner)', async () => {
      const winner = Object.assign(new VirtualIban(), {
        id: 11,
        iban: 'CH4400762011623852958',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: chf,
        bank: { id: 11, name: IbanBankName.YAPEAL },
      });
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'CH4400762011623852959',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: chf,
        bank: { id: 11, name: IbanBankName.YAPEAL },
      });
      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [winner];
        return [];
      });
      manager.findOne.mockResolvedValue(null);

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [{ virtualIban: loser, reason: 'merged' }]);

      expect(loser.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(manager.update).not.toHaveBeenCalledWith(VirtualIbanIssuanceIntent, expect.anything(), expect.anything());
    });

    it('leaves a non-winner COMPLETED historical intent untouched when it is not reopenable', async () => {
      const masterIban = 'LI21088110100111K0MAE';
      const slaveIban = 'LI21088110100111K0SLE';
      const historicalNonWinnerIban = 'LI21088110100111K0OLD';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 11,
        iban: masterIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 22,
        iban: slaveIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      // Winner-side Completed on master (surviving vIBAN). Non-winner Completed points at a
      // different, non-surviving externalIban and must be left fully untouched.
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: masterIban,
        requestReference: 'dfx-viban-master-completed',
        error: null,
      });
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: historicalNonWinnerIban,
        requestReference: 'dfx-viban-slave-old-completed',
        error: null,
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntent.id, masterIntent],
        [slaveIntent.id, slaveIntent],
      ]);

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [masterViban];
        if (entity === VirtualIbanIssuanceIntent) {
          return [masterIntent, slaveIntent].filter((i) => i.userDataId === slaveId);
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (entity, options: { where?: { id?: number; userDataId?: number; iban?: string } }) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId === masterId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === masterId) ?? null;
            }
            if (options?.where?.userDataId === slaveId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === slaveId) ?? null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban === masterIban) return masterViban;
          return null;
        },
      );

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` },
      ]);

      // COMPLETED non-winner: no failFrickIntentLocked → no FAILED-transition event/save for it.
      expect(manager.save).not.toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: slaveIntent.id,
          nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        }),
      );
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(slaveIntent.error).toBeNull();
      expect(slaveIntent.userDataId).toBe(slaveId);
      expect(slaveIntent.externalIban).toBe(historicalNonWinnerIban);

      // Winner-side Completed stays Completed under the surviving owner.
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(masterIntent.userDataId).toBe(masterId);
      expect(masterIntent.externalIban).toBe(masterIban);
    });

    it('marks a non-winner FAILED historical intent as merge-superseded when it is not reopenable', async () => {
      const masterIban = 'LI21088110100111K0MAE';
      const slaveIban = 'LI21088110100111K0SLE';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 11,
        iban: masterIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 22,
        iban: slaveIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      // Slave intent is already Failed (historical) — not the winner-side Completed. It must be
      // permanently merge-marked in place so reconciliation never reopens it under the retired id.
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: masterIban,
        requestReference: 'dfx-viban-master-completed',
        error: null,
      });
      const slaveRef = 'dfx-viban-slave-old-fail';
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        externalIban: null,
        requestReference: slaveRef,
        error: 'previous failure',
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntent.id, masterIntent],
        [slaveIntent.id, slaveIntent],
      ]);

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [masterViban];
        if (entity === VirtualIbanIssuanceIntent) {
          return [masterIntent, slaveIntent].filter((i) => i.userDataId === slaveId);
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (entity, options: { where?: { id?: number; userDataId?: number; iban?: string } }) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId === masterId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === masterId) ?? null;
            }
            if (options?.where?.userDataId === slaveId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === slaveId) ?? null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban === masterIban) return masterViban;
          return null;
        },
      );

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` },
      ]);

      // FAILED non-winner: status stays Failed; error is overwritten with merge-superseded message;
      // userDataId is NOT relocated (only the winner intent is relocated).
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(slaveIntent.error).toContain(`${CREATE_PATH_REFERENCE_MARKER}${slaveRef}`);
      expect(slaveIntent.error).toContain(`Superseded by account merge of userData ${slaveId} into ${masterId}`);
      expect(slaveIntent.userDataId).toBe(slaveId);

      // Winner-side Completed stays Completed under the surviving owner.
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(masterIntent.userDataId).toBe(masterId);
      expect(masterIntent.externalIban).toBe(masterIban);
    });

    it('reassigns winner-side intent to master without park-swap when master has no intent row', async () => {
      const slaveIban = 'LI21088110100111K0SLE';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 30,
        iban: 'LI21088110100111K0MAE',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 20,
        iban: slaveIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      // Master has no Frick intent (e.g. Yapeal-era master account); only the slave completed onto the winner.
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: slaveIban,
        requestReference: 'dfx-viban-slave-completed',
        error: null,
      });

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [slaveViban];
        if (entity === VirtualIbanIssuanceIntent) {
          return slaveIntent.userDataId === slaveId ? [slaveIntent] : [];
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (entity, options: { where?: { id?: number; userDataId?: number; iban?: string } }) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id === slaveIntent.id) return slaveIntent;
            if (options?.where?.userDataId === masterId) return null;
            if (options?.where?.userDataId === slaveId) {
              return slaveIntent.userDataId === slaveId ? slaveIntent : null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban === slaveIban) return slaveViban;
          return null;
        },
      );
      manager.update.mockImplementation(async (entity, id, values: Record<string, unknown>) => {
        if (entity === VirtualIbanIssuanceIntent && id === slaveIntent.id && values.userDataId != null) {
          slaveIntent.userDataId = values.userDataId as number;
        }
        if (entity === VirtualIban && id === slaveViban.id) {
          const userData = values.userData as { id: number } | undefined;
          if (userData?.id != null) slaveViban.userData = { id: userData.id } as UserData;
        }
        return { affected: 1 };
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: masterViban, reason: `Merged into virtual IBAN ${slaveViban.id}` },
      ]);

      expect(manager.update).toHaveBeenCalledWith(VirtualIban, slaveViban.id, {
        userData: { id: masterId },
      });
      expect(manager.update).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, slaveIntent.id, {
        userDataId: masterId,
      });
      // No park step (negative userDataId) — master slot was free.
      expect(manager.update).not.toHaveBeenCalledWith(
        VirtualIbanIssuanceIntent,
        slaveIntent.id,
        expect.objectContaining({ userDataId: -slaveIntent.id }),
      );
      expect(slaveIntent.userDataId).toBe(masterId);
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
    });

    it('groups multiple losers for the same currency+bank pair into one winner resolve', async () => {
      const winner = Object.assign(new VirtualIban(), {
        id: 10,
        iban: 'LI21088110100111K010E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const loserA = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      const loserB = Object.assign(new VirtualIban(), {
        id: 23,
        iban: 'LI21088110100111K023E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [winner];
        return [];
      });
      manager.findOne.mockResolvedValue(null);

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: loserA, reason: 'merged A' },
        { virtualIban: loserB, reason: 'merged B' },
      ]);

      expect(loserA.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(loserB.status).toBe(VirtualIbanStatus.DEACTIVATED);
      // Single winner lookup for the shared pair (not one per loser).
      expect(manager.find).toHaveBeenCalledWith(
        VirtualIban,
        expect.objectContaining({
          where: expect.any(Array),
        }),
      );
      const vibanFinds = manager.find.mock.calls.filter((c) => c[0] === VirtualIban);
      expect(vibanFinds).toHaveLength(1);
    });

    it('fails an InFlight loser-side intent as merge-superseded', async () => {
      const masterIban = 'LI21088110100111K0MAE';
      const masterViban = Object.assign(new VirtualIban(), {
        id: 11,
        iban: masterIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: masterId },
        currency: eur,
        bank: frickBank,
      });
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K0SLE',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
      });
      const masterIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 500,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: masterIban,
        requestReference: 'dfx-viban-master-completed',
        error: null,
      });
      const slaveIntent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 501,
        userDataId: slaveId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        requestReference: 'dfx-viban-slave-inflight',
        error: null,
      });
      const intentsById = new Map<number, VirtualIbanIssuanceIntent>([
        [masterIntent.id, masterIntent],
        [slaveIntent.id, slaveIntent],
      ]);

      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [masterViban];
        if (entity === VirtualIbanIssuanceIntent) {
          return [masterIntent, slaveIntent].filter((i) => i.userDataId === slaveId);
        }
        return [];
      });
      manager.findOne.mockImplementation(
        async (entity, options: { where?: { id?: number; userDataId?: number; iban?: string } }) => {
          if (entity === VirtualIbanIssuanceIntent) {
            if (options?.where?.id != null) return intentsById.get(options.where.id) ?? null;
            if (options?.where?.userDataId === masterId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === masterId) ?? null;
            }
            if (options?.where?.userDataId === slaveId) {
              return [masterIntent, slaveIntent].find((i) => i.userDataId === slaveId) ?? null;
            }
          }
          if (entity === VirtualIban && options?.where?.iban === masterIban) return masterViban;
          return null;
        },
      );

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [
        { virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` },
      ]);

      // Loser-side: InFlight → permanently merge-failed under the retired slave id (not reassigned).
      expect(slaveIntent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(slaveIntent.error).toContain(MERGE_SUPERSEDED_MARKER);
      expect(slaveIntent.error).toContain(`${CREATE_PATH_REFERENCE_MARKER}dfx-viban-slave-inflight`);
      expect(slaveIntent.userDataId).toBe(slaveId);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: slaveIntent.id,
          previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        }),
      );
      // Winner-side Completed stays Completed under master (both sides of the pair).
      expect(masterIntent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(masterIntent.userDataId).toBe(masterId);
      expect(masterIntent.externalIban).toBe(masterIban);
      expect(slaveViban.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(masterViban.active).toBe(true);
    });
  });

  describe('finalizeFrickIssuance / resetFrickIntentToPending reference integrity (B2)', () => {
    const eur = { id: 4, name: 'EUR' } as any;
    const frickBank = {
      id: 19,
      iban: 'LI32088110105923K000C',
      receive: true,
      name: IbanBankName.FRICK,
    } as any;
    const reserved = {
      iban: 'LI75088110105923K000E',
      providerAccountRef: 'LI75088110105923K000E',
    };
    const callerReference = 'dfx-viban-caller-captured-reference01';

    // Private methods are exercised directly — practical given the multi-transaction claim path
    // and matching the task's allowance for direct testing when more practical.
    const finalize = (intentId: number, expectedRequestReference: string): Promise<VirtualIban> =>
      (service as any).finalizeFrickIssuance(intentId, expectedRequestReference, userData, frickBank, eur, reserved);

    const reset = (intentId: number, expectedRequestReference: string, message: string): Promise<void> =>
      (service as any).resetFrickIntentToPending(intentId, expectedRequestReference, message);

    beforeEach(() => {
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => value);
    });

    it('refuses finalize and alerts when requestReference changed under lock', async () => {
      manager.findOne.mockResolvedValue(
        Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: 'dfx-viban-rotated-by-reconciliation0001',
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          externalIban: null,
          error: null,
        }),
      );

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [expect.stringContaining('reason=finalize: requestReference changed under lock')],
        },
      });
      const mailErrors = (notificationService.sendMail as jest.Mock).mock.calls[0][0].input.errors[0] as string;
      expect(mailErrors).toContain(`intentId=301`);
      expect(mailErrors).toContain(`userDataId=${userData.id}`);
      expect(mailErrors).not.toContain(callerReference);
      expect(mailErrors).not.toContain('dfx-viban-rotated');
      expect(mailErrors).not.toContain(reserved.iban);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses finalize and alerts when intent is FAILED with MERGE_SUPERSEDED_MARKER even if reference matches', async () => {
      const requestReference = 'dfx-viban-merge-superseded-ref-00000001';
      const mergeError = (
        `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${requestReference}`
      ).slice(0, 2000);

      manager.findOne.mockResolvedValue(
        Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference,
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          externalIban: null,
          error: mergeError,
        }),
      );

      await expect(finalize(301, requestReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [expect.stringContaining('reason=finalize: intent was terminated by an account merge')],
        },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses reset and alerts when requestReference changed under lock', async () => {
      manager.findOne.mockResolvedValue(
        Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: 'dfx-viban-rotated-before-reset-00000001',
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          externalIban: null,
          error: null,
        }),
      );

      await expect(reset(301, callerReference, 'Bank Frick virtual IBAN create rejected')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [expect.stringContaining('reason=reset: requestReference changed under lock')],
        },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('still throws ServiceUnavailableException when notification delivery fails', async () => {
      jest.spyOn(notificationService, 'sendMail').mockRejectedValue(new Error('smtp down'));
      manager.findOne.mockResolvedValue(
        Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: 'dfx-viban-rotated-notify-fail-00000001',
          userDataId: userData.id,
          currencyId: eur.id,
          bankId: frickBank.id,
          status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          externalIban: null,
          error: null,
        }),
      );

      await expect(finalize(301, callerReference)).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });

    it('refuses finalize when intent.externalIban conflicts with the recovered IBAN', async () => {
      manager.findOne.mockImplementation(async (entity) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return Object.assign(new VirtualIbanIssuanceIntent(), {
            id: 301,
            requestReference: callerReference,
            userDataId: userData.id,
            currencyId: eur.id,
            bankId: frickBank.id,
            status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
            externalIban: 'LI99OTHER00000000001',
            error: null,
          });
        }
        return null;
      });

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses finalize when the intent row is missing under lock', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });

    it('refuses finalize when an existing local row has an incompatible ownership binding', async () => {
      manager.findOne.mockImplementation(async (entity, options: { where?: { iban?: string } }) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return Object.assign(new VirtualIbanIssuanceIntent(), {
            id: 301,
            requestReference: callerReference,
            userDataId: userData.id,
            currencyId: eur.id,
            bankId: frickBank.id,
            status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
            externalIban: null,
            error: null,
          });
        }
        if (entity === VirtualIban && options?.where?.iban === reserved.iban) {
          return Object.assign(new VirtualIban(), {
            id: 77,
            iban: reserved.iban,
            userData: { id: 999 },
            bank: frickBank,
            currency: eur,
            buy: null,
            active: true,
            status: VirtualIbanStatus.ACTIVE,
          });
        }
        return null;
      });

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });

    it('refuses finalize when an existing local row has a BBAN mismatch', async () => {
      manager.findOne.mockImplementation(async (entity, options: { where?: { iban?: string } }) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return Object.assign(new VirtualIbanIssuanceIntent(), {
            id: 301,
            requestReference: callerReference,
            userDataId: userData.id,
            currencyId: eur.id,
            bankId: frickBank.id,
            status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
            externalIban: null,
            error: null,
          });
        }
        if (entity === VirtualIban && options?.where?.iban === reserved.iban) {
          return Object.assign(new VirtualIban(), {
            id: 77,
            iban: reserved.iban,
            bban: 'old-bban',
            userData,
            bank: frickBank,
            currency: eur,
            buy: null,
            active: true,
            status: VirtualIbanStatus.ACTIVE,
            providerAccountRef: reserved.providerAccountRef,
          });
        }
        return null;
      });

      await expect(
        (service as any).finalizeFrickIssuance(301, callerReference, userData, frickBank, eur, {
          ...reserved,
          bban: 'new-bban',
        }),
      ).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });

    it('refuses finalize when an existing local row has a providerAccountRef mismatch', async () => {
      manager.findOne.mockImplementation(async (entity, options: { where?: { iban?: string } }) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return Object.assign(new VirtualIbanIssuanceIntent(), {
            id: 301,
            requestReference: callerReference,
            userDataId: userData.id,
            currencyId: eur.id,
            bankId: frickBank.id,
            status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
            externalIban: null,
            error: null,
          });
        }
        if (entity === VirtualIban && options?.where?.iban === reserved.iban) {
          return Object.assign(new VirtualIban(), {
            id: 77,
            iban: reserved.iban,
            userData,
            bank: frickBank,
            currency: eur,
            buy: null,
            active: true,
            status: VirtualIbanStatus.ACTIVE,
            providerAccountRef: 'LI00DIFFERENT000000001',
          });
        }
        return null;
      });

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });

    it('refuses finalize when a different active Frick personal IBAN already exists for the triple', async () => {
      manager.findOne.mockImplementation(async (entity, options: { where?: { iban?: string } }) => {
        if (entity === VirtualIbanIssuanceIntent) {
          return Object.assign(new VirtualIbanIssuanceIntent(), {
            id: 301,
            requestReference: callerReference,
            userDataId: userData.id,
            currencyId: eur.id,
            bankId: frickBank.id,
            status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
            externalIban: null,
            error: null,
          });
        }
        if (entity === VirtualIban) {
          // by-iban miss, then active-for-user-currency-bank hit with a different IBAN
          if (options?.where?.iban) return null;
          return Object.assign(new VirtualIban(), {
            id: 88,
            iban: 'LI88EXISTING000000001',
            userData,
            bank: frickBank,
            currency: eur,
            buy: null,
            active: true,
            status: VirtualIbanStatus.ACTIVE,
          });
        }
        return null;
      });

      await expect(finalize(301, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    });
  });

  describe('resetStuckFrickIntentForReconciliationOnly', () => {
    beforeEach(() => {
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => value);
    });

    it('rotates requestReference and reopens InFlight/Failed intents for reconciliation', async () => {
      const oldReference = 'dfx-viban-stuck-old-reference-0000000001';
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: oldReference,
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);

      await expect(service.resetStuckFrickIntentForReconciliationOnly(301, oldReference)).resolves.toBe(true);

      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(intent.externalIban).toBeNull();
      expect(intent.requestReference).not.toBe(oldReference);
      expect(intent.requestReference).toMatch(/^dfx-viban-/);
      expect(intent.error).toContain(CREATE_PATH_REFERENCE_MARKER + oldReference);
    });

    it('returns false without mutating when expectedRequestReference no longer matches', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-already-rotated-000000000001',
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);

      await expect(
        service.resetStuckFrickIntentForReconciliationOnly(301, 'dfx-viban-stale-expected-000000000001'),
      ).resolves.toBe(false);
      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
      expect(intent.requestReference).toBe('dfx-viban-already-rotated-000000000001');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns false when status is no longer InFlight/Failed (concurrent completion)', async () => {
      const oldReference = 'dfx-viban-already-completed-ref-00000001';
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: oldReference,
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: 'LI75088110105923K000E',
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);

      await expect(service.resetStuckFrickIntentForReconciliationOnly(301, oldReference)).resolves.toBe(false);
      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(intent.requestReference).toBe(oldReference);
    });

    it('returns false without resetting a merge-superseded FAILED intent even when the reference matches', async () => {
      const oldReference = 'dfx-viban-merge-superseded-ref-00000001';
      const mergeError = (
        `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${oldReference}`
      ).slice(0, 2000);
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: oldReference,
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.FAILED,
        externalIban: null,
        error: mergeError,
      });
      manager.findOne.mockResolvedValue(intent);

      await expect(service.resetStuckFrickIntentForReconciliationOnly(301, oldReference)).resolves.toBe(false);
      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(intent.requestReference).toBe(oldReference);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('resetFrickIntentToPendingLocked argument guards', () => {
    // These two throws are intentional fail-closed API contracts of the private helper. No production
    // caller currently passes the illegal (rotate, nextRef) combinations; they are exercised directly
    // so a future caller cannot silently mis-rotate a money-path reference.
    const locked = (
      intent: VirtualIbanIssuanceIntent,
      rotateReference: boolean,
      nextRequestReference: string | null,
    ): Promise<boolean> =>
      (service as any).resetFrickIntentToPendingLocked(
        manager,
        intent,
        [VirtualIbanIssuanceIntentStatus.IN_FLIGHT],
        'guard test',
        rotateReference,
        nextRequestReference,
      );

    it('throws when rotateReference is true but nextRequestReference is null', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        requestReference: 'dfx-viban-guard-ref',
      });

      await expect(locked(intent, true, null)).rejects.toThrow(
        'resetFrickIntentToPendingLocked requires nextRequestReference when rotating (intentId=301)',
      );
    });

    it('throws when rotateReference is false but nextRequestReference is provided', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        requestReference: 'dfx-viban-guard-ref',
      });

      await expect(locked(intent, false, 'dfx-viban-should-not-be-here-00000001')).rejects.toThrow(
        'resetFrickIntentToPendingLocked must not receive nextRequestReference when not rotating (intentId=301)',
      );
    });
  });

  describe('failFrickIntentLocked and resolveVirtualIbanId edge cases', () => {
    beforeEach(() => {
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => value);
    });

    it('does not overwrite a COMPLETED intent when failFrickIntentLocked races with completion', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-already-completed-0000000001',
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: 'LI75088110105923K000E',
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);

      await (service as any).failFrickIntentLocked(manager, 301, 'should be ignored');

      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(intent.error).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('resolveVirtualIbanId returns the VirtualIban id when a row matches', async () => {
      manager.findOne.mockResolvedValue({ id: 99 });
      const intentIds = { intentId: 301, userDataId: userData.id, currencyId: 4, bankId: 19 };
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await expect((service as any).resolveVirtualIbanId(manager, 'LI75088110105923K000E', intentIds)).resolves.toBe(
        99,
      );
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIban, {
        where: { iban: 'LI75088110105923K000E' },
        select: ['id'],
      });
      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('resolveVirtualIbanId returns null when the IBAN has no local VirtualIban row', async () => {
      manager.findOne.mockResolvedValue(null);
      const intentIds = { intentId: 301, userDataId: userData.id, currencyId: 4, bankId: 19 };
      const orphanIban = 'LI75088110105923K000E';
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await expect((service as any).resolveVirtualIbanId(manager, orphanIban, intentIds)).resolves.toBeNull();
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIban, {
        where: { iban: orphanIban },
        select: ['id'],
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /resolveVirtualIbanId: genuine miss.*intentId=301.*userDataId=7.*currencyId=4.*bankId=19/,
        ),
      );
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [
            expect.stringContaining('reason=resolveVirtualIbanId: genuine miss — no VirtualIban row for stored IBAN'),
          ],
        },
      });
      const mailErrors = (notificationService.sendMail as jest.Mock).mock.calls[0][0].input.errors[0] as string;
      expect(mailErrors).toContain('intentId=301');
      expect(mailErrors).toContain(`userDataId=${userData.id}`);
      expect(mailErrors).toContain('currencyId=4');
      expect(mailErrors).toContain('bankId=19');
      expect(mailErrors).not.toContain(orphanIban);
      expect(loggerErrorSpy.mock.calls.flat().join(' ')).not.toContain(orphanIban);
    });

    it('resolveVirtualIbanId returns null for null/undefined IBAN without querying', async () => {
      const intentIds = { intentId: 301, userDataId: userData.id, currencyId: 4, bankId: 19 };

      await expect((service as any).resolveVirtualIbanId(manager, null, intentIds)).resolves.toBeNull();
      await expect((service as any).resolveVirtualIbanId(manager, undefined, intentIds)).resolves.toBeNull();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('transition event previousVirtualIbanId stays null when externalIban has no local row', async () => {
      const orphanIban = 'LI75088110105923K000E';
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-orphan-external-iban-00000001',
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: orphanIban,
        error: null,
      });
      manager.findOne.mockImplementation(async (entity) => {
        if (entity === VirtualIbanIssuanceIntent) return intent;
        // VirtualIban lookup for resolveVirtualIbanId — miss
        return null;
      });
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await (service as any).failFrickIntentLocked(manager, 301, 'classified failure');

      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.FAILED);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: 301,
          previousVirtualIbanId: null,
          nextVirtualIbanId: null,
          nextError: 'classified failure',
        }),
      );
      // Transition still completes despite genuine miss; alarm is raised (loud, not silent).
      expect(notificationService.sendMail).toHaveBeenCalled();
      const mailErrors = (notificationService.sendMail as jest.Mock).mock.calls
        .map((call) => call[0].input.errors[0] as string)
        .join(' ');
      expect(mailErrors).toContain('intentId=301');
      expect(mailErrors).toContain(`userDataId=${userData.id}`);
      expect(mailErrors).not.toContain(orphanIban);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('genuine miss'));
    });
  });

  /**
   * Park-swap unique-index safeguard regression.
   *
   * pg-mem's real unique index on (userDataId, currencyId, bankId) is what gives this test teeth —
   * a plain jest object mock cannot catch a reordering regression (e.g. moving the winner onto
   * masterId BEFORE relocating the blocker). Only a real unique-constraint engine fails that case.
   */
  describe('resolveMergedVirtualIbanPairLocked park-swap (pg-mem unique index)', () => {
    const masterId = 1000;
    const slaveId = 2000;
    const currencyId = 1;
    const bankId = 10;
    const winnerIban = 'LI21088110100111K0WIN';
    const blockingIban = 'LI21088110100111K0BLK';

    let pgDataSource: DataSource;

    beforeAll(async () => {
      const db = newDb();
      // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them.
      db.public.registerFunction({
        name: 'version',
        returns: DataType.text,
        implementation: () => 'PostgreSQL 15.0',
      });
      db.public.registerFunction({
        name: 'current_database',
        returns: DataType.text,
        implementation: () => 'test',
      });

      pgDataSource = (await db.adapters.createTypeormDataSource({
        type: 'postgres',
        entities: [VirtualIbanIssuanceIntent, VirtualIbanIssuanceEvent],
        synchronize: true,
      })) as DataSource;
      await pgDataSource.initialize();
    });

    afterAll(async () => {
      if (pgDataSource?.isInitialized) await pgDataSource.destroy();
    });

    beforeEach(async () => {
      await pgDataSource.getRepository(VirtualIbanIssuanceEvent).clear();
      await pgDataSource.getRepository(VirtualIbanIssuanceIntent).clear();
    });

    it('relocates winner onto master without unique-constraint violation when master already holds a blocker row', async () => {
      const realManager = pgDataSource.manager;

      // COMPLETED blocker on master for the pair — left untouched by the non-winner-marking loop
      // (isolates the park-swap step from merge-supersede marking).
      const blocking = await realManager.save(
        VirtualIbanIssuanceIntent,
        Object.assign(new VirtualIbanIssuanceIntent(), {
          requestReference: 'dfx-viban-master-blocker',
          userDataId: masterId,
          currencyId,
          bankId,
          status: VirtualIbanIssuanceIntentStatus.COMPLETED,
          externalIban: blockingIban,
          error: null,
        }),
      );
      // COMPLETED winner intent on slave whose externalIban matches the surviving vIBAN.
      const winnerIntent = await realManager.save(
        VirtualIbanIssuanceIntent,
        Object.assign(new VirtualIbanIssuanceIntent(), {
          requestReference: 'dfx-viban-slave-winner',
          userDataId: slaveId,
          currencyId,
          bankId,
          status: VirtualIbanIssuanceIntentStatus.COMPLETED,
          externalIban: winnerIban,
          error: null,
        }),
      );

      const winnerViban = Object.assign(new VirtualIban(), {
        id: 20,
        iban: winnerIban,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: { id: currencyId },
        bank: { id: bankId },
      });

      // Thin EntityManager surface used by resolveMergedVirtualIbanPairLocked: forward intent/event
      // ops to real pg-mem; stub VirtualIban (relation-heavy entity out of scope for this test).
      const proxyManager = {
        find: async (entity: unknown, options?: unknown) => {
          if (entity === VirtualIbanIssuanceIntent || entity === VirtualIbanIssuanceEvent) {
            return realManager.find(entity as typeof VirtualIbanIssuanceIntent, options as never);
          }
          if (entity === VirtualIban) return [winnerViban];
          return [];
        },
        findOne: async (entity: unknown, options?: unknown) => {
          if (entity === VirtualIbanIssuanceIntent || entity === VirtualIbanIssuanceEvent) {
            return realManager.findOne(entity as typeof VirtualIbanIssuanceIntent, options as never);
          }
          return null;
        },
        update: async (entity: unknown, criteria: unknown, partialEntity: unknown) => {
          if (entity === VirtualIbanIssuanceIntent || entity === VirtualIbanIssuanceEvent) {
            return realManager.update(
              entity as typeof VirtualIbanIssuanceIntent,
              criteria as never,
              partialEntity as never,
            );
          }
          // VirtualIban ownership move is out of scope — accept as no-op success.
          return { affected: 1, raw: [], generatedMaps: [] };
        },
        create: (entity: unknown, plainObject?: unknown) => realManager.create(entity as never, plainObject as never),
        save: async (entityOrTarget: unknown, maybeEntity?: unknown) => {
          if (maybeEntity !== undefined) {
            return realManager.save(entityOrTarget as never, maybeEntity as never);
          }
          return realManager.save(entityOrTarget as never);
        },
      };

      // Call the REAL production method — do not reimplement park-swap in the test.
      await expect(
        (service as any).resolveMergedVirtualIbanPairLocked(proxyManager, masterId, slaveId, currencyId, bankId),
      ).resolves.toBeUndefined();

      // Assert end-state via real SQL against pg-mem (not in-memory object references).
      const rows = (await realManager.query(
        `SELECT "id", "userDataId", "externalIban", "status"
         FROM "virtual_iban_issuance_intent"
         ORDER BY "id"`,
      )) as { id: number; userDataId: number; externalIban: string; status: string }[];

      const winnerRow = rows.find((r) => r.id === winnerIntent.id);
      const blockingRow = rows.find((r) => r.id === blocking.id);

      expect(winnerRow).toBeDefined();
      expect(blockingRow).toBeDefined();
      // Winner relocated onto master; former blocker swapped onto winner's previous owner (slave).
      expect(winnerRow!.userDataId).toBe(masterId);
      expect(blockingRow!.userDataId).toBe(slaveId);
      expect(winnerRow!.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(blockingRow!.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(winnerRow!.externalIban).toBe(winnerIban);
      expect(blockingRow!.externalIban).toBe(blockingIban);
    });
  });
});
