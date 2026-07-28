import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataType, newDb } from 'pg-mem';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { DataSource, EntityManager, FindOperator, IsNull } from 'typeorm';
import { BankService } from '../../bank/bank.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { VibanAccountHolder } from '../providers/viban-account-holder.enum';
import { VibanNotCreatedError } from '../providers/viban-provider.interface';
import { YapealVibanProvider } from '../providers/yapeal-viban.provider';
import { VirtualIban, VirtualIbanStatus } from '../virtual-iban.entity';
import { VirtualIbanIssuanceEvent } from '../virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from '../virtual-iban-issuance-intent.entity';
import { VirtualIbanLifecycleEvent } from '../virtual-iban-lifecycle-event.entity';
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
  let issuanceUserDataFindOne: jest.Mock;
  let manager: {
    exists: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
    update: jest.Mock;
    getRepository: jest.Mock;
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
    issuanceUserDataFindOne = jest.fn().mockResolvedValue(userData);
    manager = {
      exists: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockImplementation(async (entity) => {
        if (entity === UserData) return userData;
        return null;
      }),
      create: jest.fn().mockImplementation((entity, value) => Object.assign(new entity(), value)),
      save: jest.fn().mockImplementation(async (value) => value),
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === UserData) return { findOne: issuanceUserDataFindOne };
        throw new Error(`Unexpected repository ${String(entity)}`);
      }),
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

  describe('lockUserLevelIssuanceForMerge', () => {
    it('locks only Frick issuance keys for both accounts in deterministic order', async () => {
      const mergeManager = { query: jest.fn().mockResolvedValue([]) } as unknown as EntityManager;

      await service.lockUserLevelIssuanceForMerge(20, 10, mergeManager);

      expect((mergeManager.query as jest.Mock).mock.calls).toEqual([
        ['SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['virtual-iban-issuance:Bank Frick:EUR', '10']],
        ['SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['virtual-iban-issuance:Bank Frick:EUR', '20']],
      ]);
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
      jest.spyOn(yapealVibanProvider, 'reserveViban').mockImplementation(async () => {
        expect(transactionActive).toBe(false);
        return {
          iban: 'CH4400762011623852958',
          bban: '761623852958',
          providerAccountRef: 'yapeal-uid-1',
        };
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

    it('propagates a bank lookup failure before calling Yapeal', async () => {
      const operationFailure = new BadRequestException('No bank available for this currency');
      jest.spyOn(bankService, 'getBankInternal').mockRejectedValueOnce(operationFailure);

      await expect(service.createForUser(userData, 'CHF')).rejects.toBe(operationFailure);
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
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
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not strand CHF issuance after a Yapeal failure and retries without a Frick intent', async () => {
      const providerError = new Error('Yapeal unavailable');
      jest.spyOn(yapealVibanProvider, 'reserveViban').mockRejectedValueOnce(providerError).mockResolvedValueOnce({
        iban: 'CH4400762011623852958',
        bban: '761623852958',
        providerAccountRef: 'yapeal-uid-1',
      });
      await expect(service.createForUser(userData, 'CHF')).rejects.toBe(providerError);
      await expect(service.createForUser(userData, 'CHF')).resolves.toMatchObject({
        iban: 'CH4400762011623852958',
        providerAccountRef: 'yapeal-uid-1',
      });
      expect(yapealVibanProvider.reserveViban).toHaveBeenCalledTimes(2);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('virtual_iban_issuance_intent'))).toBe(
        false,
      );
    });

    it('exposes post-commit merge cache invalidation without database work', () => {
      service.invalidateCacheAfterMerge();

      expect(virtualIbanRepo.invalidateCache).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction).not.toHaveBeenCalled();
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
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(currency as any);
      jest.spyOn(yapealVibanProvider, 'isAvailable').mockReturnValue(true);
      jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue(bank as any);
      jest.spyOn(yapealVibanProvider, 'reserveViban').mockImplementation(async () => {
        expect(transactionActive).toBe(false);
        return {
          iban: 'CH4400762011623852958',
          bban: '761623852958',
          providerAccountRef: 'yapeal-uid-buy',
        };
      });
      jest.spyOn(virtualIbanRepo, 'create').mockImplementation((entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'save').mockImplementation(async (entity) => entity as VirtualIban);
      jest.spyOn(virtualIbanRepo, 'invalidateCache').mockImplementation(() => undefined);

      await service.createForBuy(userData, buy, 'CHF');

      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
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
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when buy already has an active personal IBAN', async () => {
      const buy = { id: 55, asset: { name: 'BTC' } } as Buy;
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue({ id: 1 } as VirtualIban);

      await expect(service.createForBuy(userData, buy, 'CHF')).rejects.toThrow(ConflictException);
      expect(yapealVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('never uses Frick for generic EUR buy-specific creation', async () => {
      const buy = { id: 55, asset: { name: 'BTC' } } as Buy;
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);
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
      manager.query.mockImplementation(async (sql, parameters) => {
        if (!String(sql).includes('INSERT INTO "virtual_iban_issuance_intent"')) return [];
        currentIntent ??= Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: parameters[0],
          userDataId: parameters[1],
          currencyId: parameters[2],
          bankId: parameters[3],
          provider: parameters[4],
          buyId: null,
          status: parameters[5],
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

    it('claims before preflight, performs every external call without a DB transaction, and audits transitions', async () => {
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
          previousUserDataId: userData.id,
          nextUserDataId: userData.id,
          previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
          nextStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        }),
        expect.objectContaining({
          previousUserDataId: userData.id,
          nextUserDataId: userData.id,
          previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          nextStatus: VirtualIbanIssuanceIntentStatus.COMPLETED,
          nextVirtualIbanId: 501,
        }),
      ]);
      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(manager.create).toHaveBeenCalledWith(
        VirtualIban,
        expect.objectContaining({ userData, bank: frickBank, currency: eur, buy: null }),
      );
    });

    it('follows a merged owner after the lock before creating a Frick intent', async () => {
      const master = Object.assign(new UserData(), {
        id: 8,
        status: UserDataStatus.ACTIVE,
        kycLevel: KycLevel.LEVEL_50,
      });
      issuanceUserDataFindOne
        .mockResolvedValueOnce(
          Object.assign(new UserData(), {
            id: userData.id,
            status: UserDataStatus.MERGED,
            firstname: `Merged into ${master.id}`,
          }),
        )
        .mockResolvedValue(master);
      jest.spyOn(frickVibanProvider, 'reserveViban').mockResolvedValue(reserved);

      const result = await service.getOrCreateFrickForUser(userData, 'EUR');
      expect(result.userData.id).toBe(master.id);
      expect(result.iban).toBe(reserved.iban);

      expect(currentIntent.userDataId).toBe(master.id);
      expect(manager.create).toHaveBeenCalledWith(VirtualIban, expect.objectContaining({ userData: master }));
      expect(manager.query.mock.calls.filter(([sql]) => String(sql).includes('pg_advisory_xact_lock'))).toHaveLength(3);
    });

    it('fails closed when a merged owner has no valid surviving-owner marker', async () => {
      issuanceUserDataFindOne.mockResolvedValue(
        Object.assign(new UserData(), {
          id: userData.id,
          status: UserDataStatus.MERGED,
          firstname: 'Merged without an owner',
        }),
      );

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        `Merged UserData ${userData.id} has no valid surviving owner`,
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('fails closed on a cyclic merged-owner chain', async () => {
      issuanceUserDataFindOne
        .mockResolvedValueOnce(
          Object.assign(new UserData(), {
            id: userData.id,
            status: UserDataStatus.MERGED,
            firstname: 'Merged into 8',
          }),
        )
        .mockResolvedValueOnce(
          Object.assign(new UserData(), {
            id: 8,
            status: UserDataStatus.MERGED,
            firstname: `Merged into ${userData.id}`,
          }),
        );

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        `Cyclic merged UserData ownership while issuing a virtual IBAN (${userData.id})`,
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('bounds merged-owner traversal before opening another transaction', async () => {
      issuanceUserDataFindOne.mockImplementation(async () => {
        const ownerId = issuanceUserDataFindOne.mock.calls.length + userData.id - 1;
        return Object.assign(new UserData(), {
          id: ownerId,
          status: UserDataStatus.MERGED,
          firstname: `Merged into ${ownerId + 1}`,
        });
      });

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        'Merged UserData ownership exceeds 100 transitions while issuing a virtual IBAN',
      );
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('rechecks KYC on the fresh locked owner before creating a Frick intent', async () => {
      issuanceUserDataFindOne.mockResolvedValue(
        Object.assign(new UserData(), {
          id: userData.id,
          status: UserDataStatus.ACTIVE,
          kycLevel: KycLevel.LEVEL_40,
        }),
      );

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(QuoteError.KYC_REQUIRED);
      expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), expect.anything());
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
    });

    it('returns a claimed intent to Pending when preflight fails without holding the lock', async () => {
      (frickVibanProvider.prepareVibanReservation as jest.Mock).mockRejectedValue(new Error('authorization failed'));

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED,
      );

      expect(currentIntent.status).toBe(VirtualIbanIssuanceIntentStatus.PENDING);
      expect(auditEvents.map((event) => [event.previousStatus, event.nextStatus])).toEqual([
        [VirtualIbanIssuanceIntentStatus.PENDING, VirtualIbanIssuanceIntentStatus.IN_FLIGHT],
        [VirtualIbanIssuanceIntentStatus.IN_FLIGHT, VirtualIbanIssuanceIntentStatus.PENDING],
      ]);
      expect(frickVibanProvider.reserveViban).not.toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it('maps a non-Error preflight rejection to the same 503 and reopens the claim', async () => {
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
        jest.spyOn(frickVibanProvider, 'adoptAndActivate').mockImplementation(async () => {
          expect(transactionActive).toBe(false);
          return reserved;
        });

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

    it('accepts a stale below-50 argument when the locked database row is approved', async () => {
      jest.spyOn(frickVibanProvider, 'reserveViban').mockResolvedValue(reserved);

      await expect(
        service.getOrCreateFrickForUser({ ...userData, kycLevel: KycLevel.LEVEL_40 } as UserData, 'EUR'),
      ).resolves.toMatchObject({ iban: reserved.iban });

      expect(frickVibanProvider.reserveViban).toHaveBeenCalledTimes(1);
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
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects when Frick receive bank is missing before any Frick I/O', async () => {
      jest.spyOn(bankService, 'getBankInternal').mockResolvedValue({ ...frickBank, receive: false } as any);

      await expect(service.getOrCreateFrickForUser(userData, 'EUR')).rejects.toThrow(
        QuoteError.NO_BANK_AVAILABLE_FOR_THIS_CURRENCY,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
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

    it('getActiveForUserAndCurrency keeps the merge-base selection semantics while excluding Frick', async () => {
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);

      await service.getActiveForUserAndCurrency(userData, 'CHF');

      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
        where: {
          userData: { id: 7 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
        relations: { bank: true },
      });
    });

    it('retains merge-base behavior by reusing a buy-bound Yapeal IBAN in the generic lookup', async () => {
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
        // The regressed filter excluded this row. With merge-base semantics, no buy predicate exists.
        if (buyWhere instanceof FindOperator && buyWhere.type === 'isNull') return null;
        return buyBound;
      });

      await expect(service.getActiveForUserAndCurrency(userData, 'CHF')).resolves.toBe(buyBound);
      expect(virtualIbanRepo.findOne).toHaveBeenCalled();
    });

    it('getActiveForBuyAndCurrency reads through to the database for issuance correctness', async () => {
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);

      await service.getActiveForBuyAndCurrency(55, 'CHF');

      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
        where: {
          buy: { id: 55 },
          currency: { name: 'CHF' },
          bank: { name: expect.anything() },
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
      });
      // Buy-bound lookup must remain exact and must not use IsNull.
      const where = (virtualIbanRepo.findOne as jest.Mock).mock.calls[0][0].where;
      expect(where.buy).toEqual({ id: 55 });
      expect(where.buy).not.toBeInstanceOf(FindOperator);
    });

    it('getByIban reads ownership through to the database and loads its relations', async () => {
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue(null);

      await service.getByIban('CH9300762011623852957');

      expect(virtualIbanRepo.findOne).toHaveBeenCalledWith({
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
      jest.spyOn(virtualIbanRepo, 'findOne').mockResolvedValue({
        bank: { iban: 'CH9300762011623852957' },
      } as VirtualIban);

      await expect(service.getBaseAccountIban('CH4400762011623852958')).resolves.toBe('CH9300762011623852957');
    });

    it('getVirtualIbansForAccount queries by userData id', async () => {
      jest.spyOn(virtualIbanRepo, 'findCachedBy').mockResolvedValue([]);

      await service.getVirtualIbansForAccount(7);

      expect(virtualIbanRepo.findCachedBy).toHaveBeenCalledWith('user-7', { userData: { id: 7 } });
    });

    it('getVirtualIbansForAccount uses the supplied transaction manager', async () => {
      const rows = [{ id: 9 }] as VirtualIban[];
      manager.find.mockResolvedValue(rows);

      await expect(service.getVirtualIbansForAccount(7, manager as unknown as EntityManager)).resolves.toBe(rows);

      expect(manager.find).toHaveBeenCalledWith(VirtualIban, {
        where: { userData: { id: 7 } },
        relations: { userData: true, bank: true, currency: true, buy: true },
      });
      expect(virtualIbanRepo.findCachedBy).not.toHaveBeenCalled();
    });

    it('loads only Frick virtual IBANs for account-merge handling', async () => {
      manager.find.mockResolvedValue([]);

      await service.getFrickVirtualIbansForAccount(7, manager as unknown as EntityManager);

      expect(manager.find).toHaveBeenCalledWith(VirtualIban, {
        where: { userData: { id: 7 }, bank: { name: IbanBankName.FRICK } },
        relations: { userData: true, currency: true, bank: true, buy: true },
      });
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
      dataSource.transaction((m) => (service as any).deactivateVirtualIbanLocked(m, viban, 'test deactivation'));

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
      expect(manager.create).toHaveBeenCalledWith(
        VirtualIbanLifecycleEvent,
        expect.objectContaining({
          virtualIbanId: viban.id,
          previousUserDataId: 7,
          nextUserDataId: 7,
          previousActive: true,
          nextActive: false,
          previousStatus: VirtualIbanStatus.ACTIVE,
          nextStatus: VirtualIbanStatus.DEACTIVATED,
          previousDeactivatedAt: null,
          nextDeactivatedAt: expect.any(Date),
          transitionedAt: expect.any(Date),
          reason: 'test deactivation',
        }),
      );
      const lifecycleEvent = (manager.create as jest.Mock).mock.results[0].value;
      const eventSaveOrder = manager.save.mock.invocationCallOrder.find(
        (_order, index) => manager.save.mock.calls[index][0] === lifecycleEvent,
      );
      const snapshotSaveOrder = manager.save.mock.invocationCallOrder.find(
        (_order, index) => manager.save.mock.calls[index][0] === viban,
      );
      expect(eventSaveOrder).toBeLessThan(snapshotSaveOrder);
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

    it('never queries or transitions Frick intent state for a Yapeal-issued vIBAN', async () => {
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
      expect(manager.findOne).not.toHaveBeenCalledWith(VirtualIbanIssuanceIntent, expect.anything());
      expect(manager.save).toHaveBeenCalledWith(viban);
      expect(manager.save).toHaveBeenCalledTimes(2);
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

      const deactivated = await deactivateLocked(viban);

      expect(deactivated.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIban, {
        where: { id: 42 },
        relations: { userData: true, currency: true, bank: true },
      });
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: {
          userDataId: 7,
          currencyId: eur.id,
          bankId: frickBank.id,
          provider: IbanBankName.FRICK,
          buyId: IsNull(),
        },
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

    beforeEach(() => {
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => value);
    });

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
        where: { userDataId: slaveId, provider: IbanBankName.FRICK },
      });
      expect(manager.findOne).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: {
          userDataId: masterId,
          currencyId,
          bankId,
          provider: IbanBankName.FRICK,
          buyId: IsNull(),
        },
      });
      expect(manager.update).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, slaveIntent.id, {
        userDataId: masterId,
      });
      expect(slaveIntent.userDataId).toBe(masterId);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: slaveIntent.id,
          previousUserDataId: slaveId,
          nextUserDataId: masterId,
        }),
      );
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

    it('does not lifecycle-log or reassign a single-sided Yapeal IBAN', async () => {
      const slaveViban = Object.assign(new VirtualIban(), {
        id: 44,
        iban: 'CH4400762011623852958',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: chf,
        bank: { id: 11, name: IbanBankName.YAPEAL },
        deactivatedAt: null,
      });
      manager.find.mockImplementation(async (entity, options: any) => {
        if (entity === VirtualIban) {
          // Simulate TypeORM's bank predicate: the fixed Frick-only query cannot return Yapeal.
          return options?.where?.bank?.name === IbanBankName.FRICK ? [] : [slaveViban];
        }
        if (entity === VirtualIbanIssuanceIntent) return [];
        return [];
      });

      await service.mergeUserLevelVirtualIbans(masterId, slaveId, [], manager as unknown as EntityManager);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.find).toHaveBeenCalledWith(VirtualIban, {
        where: { userData: { id: slaveId }, bank: { name: IbanBankName.FRICK } },
        relations: { userData: true, bank: true },
      });
      expect(manager.create).not.toHaveBeenCalledWith(VirtualIbanLifecycleEvent, expect.anything());
      expect(manager.update).not.toHaveBeenCalledWith(VirtualIban, slaveViban.id, expect.anything());
      expect(slaveViban.userData.id).toBe(slaveId);
    });

    it('does not deactivate either side of a same-pair Yapeal merge', async () => {
      const yapealLoser = Object.assign(new VirtualIban(), {
        id: 45,
        iban: 'CH4400762011623852959',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: chf,
        bank: { id: 11, name: IbanBankName.YAPEAL },
      });
      const deactivateSpy = jest.spyOn(service as any, 'deactivateVirtualIbanLocked');

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: yapealLoser, reason: 'must stay untouched' }],
        manager as unknown as EntityManager,
      );

      expect(deactivateSpy).not.toHaveBeenCalled();
      expect(yapealLoser.active).toBe(true);
      expect(yapealLoser.status).toBe(VirtualIbanStatus.ACTIVE);
      expect(yapealLoser.userData.id).toBe(slaveId);
    });

    it('reassigns a deactivated slave conflict loser while retaining its deactivated state', async () => {
      const loser = Object.assign(new VirtualIban(), {
        id: 45,
        iban: 'LI45088110100111K000E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        currency: eur,
        bank: frickBank,
        deactivatedAt: null,
      });
      const deactivateSpy = jest
        .spyOn(service as any, 'deactivateVirtualIbanLocked')
        .mockResolvedValue(Object.assign(loser, { active: false, status: VirtualIbanStatus.DEACTIVATED }));
      const resolvePairSpy = jest
        .spyOn(service as any, 'resolveMergedVirtualIbanPairLocked')
        .mockResolvedValue(undefined);
      manager.find.mockImplementation(async (entity) => {
        if (entity === VirtualIban) return [loser];
        if (entity === VirtualIbanIssuanceIntent) return [];
        return [];
      });

      try {
        await service.mergeUserLevelVirtualIbans(
          masterId,
          slaveId,
          [{ virtualIban: loser, reason: 'duplicate during account merge' }],
          manager as unknown as EntityManager,
        );
      } finally {
        deactivateSpy.mockRestore();
        resolvePairSpy.mockRestore();
      }

      expect(manager.create).toHaveBeenCalledWith(
        VirtualIbanLifecycleEvent,
        expect.objectContaining({
          virtualIbanId: loser.id,
          previousUserDataId: slaveId,
          nextUserDataId: masterId,
          previousActive: false,
          nextActive: false,
          previousStatus: VirtualIbanStatus.DEACTIVATED,
          nextStatus: VirtualIbanStatus.DEACTIVATED,
        }),
      );
      expect(manager.update).toHaveBeenCalledWith(VirtualIban, loser.id, {
        userData: { id: masterId },
      });
      expect(loser.userData.id).toBe(masterId);
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [
          { virtualIban: loserA, reason: 'merged A' },
          { virtualIban: loserB, reason: 'merged B' },
        ],
        manager as unknown as EntityManager,
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
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
      expect(virtualIbanRepo.invalidateCache).not.toHaveBeenCalled();
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: masterViban, reason: `Merged into virtual IBAN ${slaveViban.id}` }],
        manager as unknown as EntityManager,
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
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

      manager.find.mockImplementation(async (entity, options: { where?: unknown }) => {
        if (entity === VirtualIban) return Array.isArray(options?.where) ? [masterViban] : [];
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` }],
        manager as unknown as EntityManager,
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
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
        service.mergeUserLevelVirtualIbans(
          masterId,
          slaveId,
          [{ virtualIban: loser, reason: 'merged' }],
          manager as unknown as EntityManager,
        ),
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
        service.mergeUserLevelVirtualIbans(
          masterId,
          slaveId,
          [{ virtualIban: loser, reason: 'merged' }],
          manager as unknown as EntityManager,
        ),
      ).rejects.toThrow(
        `Account merge vIBAN dedup expected exactly one surviving winner ` +
          `(currencyId=${eur.id}, bankId=${frickBank.id}, masterId=${masterId}, slaveId=${slaveId}, found=2)`,
      );
    });

    it('ignores an unclassified loser instead of pulling a possibly-Yapeal row into Frick merge handling', async () => {
      const loser = Object.assign(new VirtualIban(), {
        id: 22,
        iban: 'LI21088110100111K022E',
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
        // currency/bank intentionally omitted
      });

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: loser, reason: 'merged' }],
        manager as unknown as EntityManager,
      );

      expect(manager.findOne).not.toHaveBeenCalled();
      expect(loser.status).toBe(VirtualIbanStatus.ACTIVE);
    });

    it('does not fail or mutate when currency/bank is absent on a non-Frick merge row', async () => {
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
        service.mergeUserLevelVirtualIbans(
          masterId,
          slaveId,
          [{ virtualIban: loser, reason: 'merged' }],
          manager as unknown as EntityManager,
        ),
      ).resolves.toBeUndefined();
      expect(loser).toMatchObject({
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        userData: { id: slaveId },
      });
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('leaves Yapeal-issued rows entirely untouched by merge handling', async () => {
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [
          { virtualIban: winner, reason: 'merged' },
          { virtualIban: loser, reason: 'merged' },
        ],
        manager as unknown as EntityManager,
      );

      expect(winner.status).toBe(VirtualIbanStatus.ACTIVE);
      expect(loser.status).toBe(VirtualIbanStatus.ACTIVE);
      expect(winner.userData.id).toBe(masterId);
      expect(loser.userData.id).toBe(slaveId);
      expect(manager.find).toHaveBeenCalledWith(VirtualIban, {
        where: { userData: { id: slaveId }, bank: { name: IbanBankName.FRICK } },
        relations: { bank: true, userData: true },
      });
      expect(manager.find).toHaveBeenCalledWith(VirtualIbanIssuanceIntent, {
        where: { userDataId: slaveId, provider: IbanBankName.FRICK },
      });
      expect(manager.findOne).not.toHaveBeenCalledWith(VirtualIbanIssuanceIntent, expect.anything());
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` }],
        manager as unknown as EntityManager,
      );

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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` }],
        manager as unknown as EntityManager,
      );

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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: masterViban, reason: `Merged into virtual IBAN ${slaveViban.id}` }],
        manager as unknown as EntityManager,
      );

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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [
          { virtualIban: loserA, reason: 'merged A' },
          { virtualIban: loserB, reason: 'merged B' },
        ],
        manager as unknown as EntityManager,
      );

      expect(loserA.status).toBe(VirtualIbanStatus.DEACTIVATED);
      expect(loserB.status).toBe(VirtualIbanStatus.DEACTIVATED);
      // Single winner lookup for the shared pair (not one per loser).
      expect(manager.find).toHaveBeenCalledWith(
        VirtualIban,
        expect.objectContaining({
          where: expect.any(Array),
        }),
      );
      const winnerFinds = manager.find.mock.calls.filter(
        (call) => call[0] === VirtualIban && Array.isArray(call[1]?.where),
      );
      expect(winnerFinds).toHaveLength(1);
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

      await service.mergeUserLevelVirtualIbans(
        masterId,
        slaveId,
        [{ virtualIban: slaveViban, reason: `Merged into virtual IBAN ${masterViban.id}` }],
        manager as unknown as EntityManager,
      );

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
    const followMergedOwner = (master: UserData | null): void => {
      issuanceUserDataFindOne
        .mockResolvedValueOnce(
          Object.assign(new UserData(), {
            id: userData.id,
            status: UserDataStatus.MERGED,
            firstname: 'Merged into 1000',
          }),
        )
        .mockResolvedValue(master);
    };

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

    it.each([
      { label: 'currency', currencyId: 999, bankId: frickBank.id },
      { label: 'bank', currencyId: eur.id, bankId: 999 },
    ])('refuses finalize when the persisted $label binding differs', async ({ currencyId, bankId }) => {
      manager.findOne.mockResolvedValue(
        Object.assign(new VirtualIbanIssuanceIntent(), {
          id: 301,
          requestReference: callerReference,
          userDataId: userData.id,
          currencyId,
          bankId,
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
          errors: [expect.stringContaining('reason=finalize: intent ownership changed under lock')],
        },
      });
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('finalizes for the persisted master when an issuance ownership event proves the merge reassignment', async () => {
      const masterId = 1000;
      const master = Object.assign(new UserData(), { id: masterId, kycLevel: KycLevel.LEVEL_50 });
      followMergedOwner(master);
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      let persistedVirtualIban: VirtualIban | undefined;
      manager.query.mockImplementation(async (sql) =>
        String(sql).includes('FROM "virtual_iban_issuance_event"')
          ? [{ previousUserDataId: userData.id, nextUserDataId: masterId }]
          : [],
      );
      manager.findOne.mockImplementation(async (entity, options) => {
        if (entity === VirtualIbanIssuanceIntent) return intent;
        if (entity === UserData) return master;
        if (entity === VirtualIban && options.where.iban)
          return persistedVirtualIban?.iban === options.where.iban ? persistedVirtualIban : null;
        return null;
      });
      manager.save.mockImplementation(async (entity) => {
        if (entity instanceof VirtualIban) {
          persistedVirtualIban = Object.assign(new VirtualIban(), entity, { id: 901 });
          return persistedVirtualIban;
        }
        return entity;
      });

      const finalized = await finalize(intent.id, callerReference);

      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"previousUserDataId" <> "nextUserDataId"'), [
        intent.id,
        eur.id,
        frickBank.id,
        101,
      ]);
      expect(persistedVirtualIban).toMatchObject({
        id: 901,
        iban: reserved.iban,
        userData: { id: masterId },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });
      expect(finalized.userData.id).toBe(masterId);
      expect(intent.requestReference).toBe(callerReference);
      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.COMPLETED);
      expect(intent.externalIban).toBe(reserved.iban);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('finalizes through a contiguous ordered multi-merge ownership chain', async () => {
      const intermediateId = 800;
      const masterId = 1000;
      const master = Object.assign(new UserData(), { id: masterId, kycLevel: KycLevel.LEVEL_50 });
      followMergedOwner(master);
      const existingVirtualIban = Object.assign(new VirtualIban(), {
        id: 901,
        iban: reserved.iban,
        bban: undefined,
        providerAccountRef: reserved.providerAccountRef,
        userData: master,
        bank: frickBank,
        currency: eur,
        buy: null,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      });
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.query.mockImplementation(async (sql) =>
        String(sql).includes('FROM "virtual_iban_issuance_event"')
          ? [
              { previousUserDataId: 9999, nextUserDataId: 9998 },
              { previousUserDataId: userData.id, nextUserDataId: intermediateId },
              { previousUserDataId: intermediateId, nextUserDataId: masterId },
            ]
          : [],
      );
      manager.findOne.mockImplementation(async (entity, options) => {
        if (entity === VirtualIbanIssuanceIntent) return intent;
        if (entity === UserData) return master;
        if (entity === VirtualIban && options.where.iban) return existingVirtualIban;
        return null;
      });

      await expect(finalize(intent.id, callerReference)).resolves.toMatchObject({
        userData: { id: masterId },
        iban: reserved.iban,
      });
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('rejects a cyclic issuance-ownership history explicitly', async () => {
      const masterId = 1000;
      followMergedOwner(Object.assign(new UserData(), { id: masterId, kycLevel: KycLevel.LEVEL_50 }));
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);
      manager.query.mockImplementation(async (sql) =>
        String(sql).includes('FROM "virtual_iban_issuance_event"')
          ? [
              { previousUserDataId: userData.id, nextUserDataId: 800 },
              { previousUserDataId: 800, nextUserDataId: userData.id },
              { previousUserDataId: userData.id, nextUserDataId: masterId },
            ]
          : [],
      );

      await expect(finalize(intent.id, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(manager.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            errors: [expect.stringContaining('reason=finalize: cyclic ownership history')],
          }),
        }),
      );
    });

    it('bounds the issuance-ownership history scan and fails closed when the limit is exceeded', async () => {
      const masterId = 1000;
      followMergedOwner(Object.assign(new UserData(), { id: masterId, kycLevel: KycLevel.LEVEL_50 }));
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);
      manager.query.mockImplementation(async (sql) =>
        String(sql).includes('FROM "virtual_iban_issuance_event"')
          ? Array.from({ length: 101 }, (_, index) => ({
              previousUserDataId: userData.id + index,
              nextUserDataId: userData.id + index + 1,
            }))
          : [],
      );

      await expect(finalize(intent.id, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $4'), [
        intent.id,
        eur.id,
        frickBank.id,
        101,
      ]);
      expect(manager.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            errors: [expect.stringContaining('reason=finalize: ownership history exceeds maximum')],
          }),
        }),
      );
    });

    it('refuses stale-owner finalize when no merge ownership event proves the reassignment', async () => {
      const masterId = 1000;
      followMergedOwner(Object.assign(new UserData(), { id: masterId, kycLevel: KycLevel.LEVEL_50 }));
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: masterId,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      manager.findOne.mockResolvedValue(intent);
      manager.query.mockResolvedValue([]);

      await expect(finalize(intent.id, callerReference)).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(manager.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [expect.stringContaining('reason=finalize: intent ownership changed without merge audit')],
        },
      });
    });

    it('fails closed when the persisted merged owner is missing', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: callerReference,
        userDataId: 1000,
        currencyId: eur.id,
        bankId: frickBank.id,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: null,
        error: null,
      });
      followMergedOwner(null);
      manager.findOne.mockImplementation(async (entity) => (entity === VirtualIbanIssuanceIntent ? intent : null));

      await expect(finalize(intent.id, callerReference)).rejects.toThrow('User data not found');

      expect(notificationService.sendMail).not.toHaveBeenCalled();
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

    it('propagates a non-integrity reset transaction failure unchanged', async () => {
      const databaseError = new Error('reset intent lookup failed');
      manager.findOne.mockRejectedValue(databaseError);

      await expect(reset(301, callerReference, 'Bank Frick virtual IBAN create rejected')).rejects.toBe(databaseError);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
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

  describe('append-only ownership helpers', () => {
    const lifecycle = (
      virtualIban: VirtualIban,
      reason: string,
      nextStatus: VirtualIbanStatus | undefined,
    ): Promise<void> =>
      (service as any).recordVirtualIbanLifecycleEventLocked(
        manager,
        virtualIban,
        {
          userDataId: 1000,
          active: true,
          status: nextStatus,
          deactivatedAt: undefined,
        },
        reason,
      );

    beforeEach(() => {
      manager.create.mockImplementation((entity, value) => Object.assign(new entity(), value));
      manager.save.mockImplementation(async (value) => value);
    });

    it('fails closed when a lifecycle transition has no previous owner', async () => {
      const virtualIban = Object.assign(new VirtualIban(), { id: 44, active: true });

      await expect(lifecycle(virtualIban, 'account merge', VirtualIbanStatus.ACTIVE)).rejects.toThrow(
        'Virtual IBAN owner missing for lifecycle audit',
      );
    });

    it('fails closed when a lifecycle transition has no reason', async () => {
      const virtualIban = Object.assign(new VirtualIban(), {
        id: 44,
        active: true,
        userData: { id: 2000 },
      });

      await expect(lifecycle(virtualIban, '   ', VirtualIbanStatus.ACTIVE)).rejects.toThrow(
        'Virtual IBAN lifecycle reason missing',
      );
    });

    it('does not rewrite an issuance intent already owned by the target user', async () => {
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 88,
        userDataId: 1000,
      });

      await (service as any).reassignFrickIntentLocked(manager, intent, 1000);

      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
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

    it('reports an integrity failure only after failFrickIntent releases its transaction', async () => {
      const orphanIban = 'LI75088110105923K000E';
      const intent = Object.assign(new VirtualIbanIssuanceIntent(), {
        id: 301,
        requestReference: 'dfx-viban-orphan-fail-wrapper',
        userDataId: userData.id,
        currencyId: 4,
        bankId: 19,
        status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        externalIban: orphanIban,
        error: null,
      });
      manager.findOne.mockImplementation(async (entity) => (entity === VirtualIbanIssuanceIntent ? intent : null));
      jest.spyOn(notificationService, 'sendMail').mockImplementation(async () => {
        expect(transactionActive).toBe(false);
        return undefined as any;
      });

      await expect((service as any).failFrickIntent(intent.id, 'classified failure')).rejects.toThrow(
        `Cannot transition Frick issuance intent ${intent.id}: stored external IBAN has no VirtualIban row`,
      );
      expect(notificationService.sendMail).toHaveBeenCalled();
    });

    it('propagates a non-integrity failure from failFrickIntent unchanged', async () => {
      const databaseError = new Error('intent lookup failed');
      manager.findOne.mockRejectedValue(databaseError);

      await expect((service as any).failFrickIntent(301, 'classified failure')).rejects.toBe(databaseError);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
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

    it('defers the integrity alert until after the locked helper returns', async () => {
      manager.findOne.mockResolvedValue(null);
      const intentIds = { intentId: 301, userDataId: userData.id, currencyId: 4, bankId: 19 };
      const orphanIban = 'LI75088110105923K000E';
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      let integrityError: unknown;
      try {
        await (service as any).resolveVirtualIbanId(manager, orphanIban, intentIds);
      } catch (error) {
        integrityError = error;
      }
      expect(integrityError).toBeInstanceOf(Error);
      expect((integrityError as Error).message).toContain(
        'Cannot transition Frick issuance intent 301: stored external IBAN has no VirtualIban row',
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();

      await service.reportIntegrityError(integrityError);
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

    it('aborts the transition when a non-null externalIban has no local row', async () => {
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

      let integrityError: unknown;
      try {
        await (service as any).failFrickIntentLocked(manager, 301, 'classified failure');
      } catch (error) {
        integrityError = error;
      }
      expect((integrityError as Error).message).toContain(
        'Cannot transition Frick issuance intent 301: stored external IBAN has no VirtualIban row',
      );

      expect(intent.status).toBe(VirtualIbanIssuanceIntentStatus.IN_FLIGHT);
      expect(intent.externalIban).toBe(orphanIban);
      expect(intent.error).toBeNull();
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
      await service.reportIntegrityError(integrityError);
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
        entities: [VirtualIbanIssuanceIntent, VirtualIbanIssuanceEvent, VirtualIbanLifecycleEvent],
        synchronize: true,
      })) as DataSource;
      await pgDataSource.initialize();
    }, 30000);

    afterAll(async () => {
      if (pgDataSource?.isInitialized) await pgDataSource.destroy();
    });

    beforeEach(async () => {
      await pgDataSource.getRepository(VirtualIbanIssuanceEvent).clear();
      await pgDataSource.getRepository(VirtualIbanLifecycleEvent).clear();
      await pgDataSource.getRepository(VirtualIbanIssuanceIntent).clear();
    });

    it('persists an ordinary state transition against the real non-null ownership schema', async () => {
      const intent = await pgDataSource.manager.save(
        VirtualIbanIssuanceIntent,
        Object.assign(new VirtualIbanIssuanceIntent(), {
          requestReference: 'dfx-viban-schema-backed-transition',
          userDataId: slaveId,
          currencyId,
          bankId,
          provider: IbanBankName.FRICK,
          status: VirtualIbanIssuanceIntentStatus.PENDING,
          externalIban: null,
          error: null,
        }),
      );

      await expect(
        (service as any).transitionFrickIntent(
          pgDataSource.manager,
          intent,
          VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          null,
          null,
        ),
      ).resolves.toMatchObject({ status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT });

      await expect(
        pgDataSource.getRepository(VirtualIbanIssuanceEvent).findOneByOrFail({ intentId: intent.id }),
      ).resolves.toMatchObject({
        userDataId: slaveId,
        previousUserDataId: slaveId,
        nextUserDataId: slaveId,
        previousStatus: VirtualIbanIssuanceIntentStatus.PENDING,
        nextStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      });
    }, 30000);

    it('persists lifecycle ownership history against the real required-column schema', async () => {
      const virtualIban = Object.assign(new VirtualIban(), {
        id: 44,
        userData: { id: slaveId },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        deactivatedAt: undefined,
      });

      await (service as any).recordVirtualIbanLifecycleEventLocked(
        pgDataSource.manager,
        virtualIban,
        {
          userDataId: masterId,
          active: true,
          status: undefined,
          deactivatedAt: undefined,
        },
        'schema-backed ownership reassignment',
      );

      await expect(
        pgDataSource.getRepository(VirtualIbanLifecycleEvent).findOneByOrFail({ virtualIbanId: virtualIban.id }),
      ).resolves.toMatchObject({
        previousUserDataId: slaveId,
        nextUserDataId: masterId,
        previousActive: true,
        nextActive: true,
        previousStatus: VirtualIbanStatus.ACTIVE,
        nextStatus: null,
        transitionedAt: expect.any(Date),
        reason: 'schema-backed ownership reassignment',
      });

      await expect(
        pgDataSource.manager.query(
          `INSERT INTO "virtual_iban_lifecycle_event"
             ("virtualIbanId", "previousUserDataId", "nextUserDataId", "previousActive", "nextActive",
              "transitionedAt", "reason")
           VALUES ($1, $2, $3, true, true, now(), NULL)`,
          [45, slaveId, masterId],
        ),
      ).rejects.toThrow(/null value in column "reason"/i);
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
          provider: IbanBankName.FRICK,
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
          provider: IbanBankName.FRICK,
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
        bank: { id: bankId, name: IbanBankName.FRICK },
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
          if (entity === VirtualIban) return { id: winnerViban.id };
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
