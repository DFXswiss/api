import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { PriceInvalidException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-invalid.exception';
import { PriceUnavailableException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-unavailable.exception';
import { EntityManager, IsNull, MoreThan, Not } from 'typeorm';
import { BankService } from '../../../bank/bank/bank.service';
import { PayoutService } from '../../../payout/services/payout.service';
import { PricingService } from '../../../pricing/services/pricing.service';
import { Fee, FeeType } from '../../entities/fee.entity';
import { BlockchainFeeRepository } from '../../repositories/blockchain-fee.repository';
import { FeeRepository } from '../../repositories/fee.repository';
import { FeeService } from '../fee.service';

describe('FeeService', () => {
  let service: FeeService;
  let blockchainFeeRepo: MockProxy<BlockchainFeeRepository>;
  let feeRepo: MockProxy<FeeRepository>;
  let userDataService: MockProxy<UserDataService>;
  let settingService: MockProxy<SettingService>;

  beforeAll(async () => {
    blockchainFeeRepo = mock<BlockchainFeeRepository>();
    feeRepo = mock<FeeRepository>();
    userDataService = mock<UserDataService>();
    settingService = mock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FeeRepository, useValue: feeRepo },
        { provide: AssetService, useValue: mock<AssetService>() },
        { provide: FiatService, useValue: mock<FiatService>() },
        { provide: UserDataService, useValue: userDataService },
        { provide: SettingService, useValue: settingService },
        { provide: WalletService, useValue: mock<WalletService>() },
        { provide: BlockchainFeeRepository, useValue: blockchainFeeRepo },
        { provide: PayoutService, useValue: mock<PayoutService>() },
        { provide: PricingService, useValue: mock<PricingService>() },
        { provide: BankService, useValue: mock<BankService>() },
        FeeService,
      ],
    }).compile();

    service = module.get<FeeService>(FeeService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('updateBlockchainFees', () => {
    const feeRow = (updated: Date) => [{ asset: { id: 398 }, amount: 1, updated } as any];

    const priceSourceOutage = () =>
      new PriceUnavailableException(
        'No valid price found for ETH -> CHF',
        Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' }),
      );

    it('logs a fresh price-source outage at warn and keeps the stored fee', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date()));
      jest.spyOn(service as any, 'calculateBlockchainFeeInChf').mockRejectedValue(priceSourceOutage());
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(
        LogLevel.WARN,
        expect.stringContaining('398'),
        expect.any(PriceUnavailableException),
      );
      expect(loggerLog).not.toHaveBeenCalledWith(LogLevel.ERROR, expect.anything(), expect.anything());
      expect(blockchainFeeRepo.save).not.toHaveBeenCalled();
    });

    it('escalates a persistent price-source outage to error once the stored fee goes stale', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date(Date.now() - 31 * 60 * 1000)));
      jest.spyOn(service as any, 'calculateBlockchainFeeInChf').mockRejectedValue(priceSourceOutage());
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(
        LogLevel.ERROR,
        expect.stringContaining('398'),
        expect.any(PriceUnavailableException),
      );
    });

    it('logs a non-transient price failure at error even while the stored fee is fresh', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date()));
      jest
        .spyOn(service as any, 'calculateBlockchainFeeInChf')
        .mockRejectedValue(new PriceInvalidException('No price rule found for asset ETH'));
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(
        LogLevel.ERROR,
        expect.stringContaining('398'),
        expect.any(PriceInvalidException),
      );
    });

    it('keeps unexpected failures at error', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date()));
      jest.spyOn(service as any, 'calculateBlockchainFeeInChf').mockRejectedValue(new Error('estimation failed'));
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining('398'), expect.any(Error));
    });
  });

  describe('describeFeeRequest', () => {
    it('logs identifying scalars only, never entity internals', () => {
      const user = createCustomUser({
        id: 42,
        address: '0x6B59e3BFF9C3ccC0F2FA59Ea7cc4245ae2F1fE64',
        signature: 'SECRET_SIGNATURE',
        ip: '203.0.113.7',
      });
      const request = {
        user,
        paymentMethodIn: 'Bank',
        bankIn: 'Olkypay',
        from: createCustomAsset({ name: 'ETH' }),
        specialCodes: [],
        allowCachedBlockchainFee: false,
      };

      const description = (service as any).describeFeeRequest(request);

      expect(description).toContain('42');
      expect(description).not.toContain('SECRET_SIGNATURE');
      expect(description).not.toContain('0x6B59e3BFF9C3ccC0F2FA59Ea7cc4245ae2F1fE64');
      expect(description).not.toContain('203.0.113.7');
    });
  });

  describe('onboarding fee', () => {
    const onboardingFee = (id: number | undefined, fixed: number): Fee =>
      Object.assign(new Fee(), {
        id,
        fixed,
        rate: 0,
        blockchainFactor: 0,
        specialCode: 'ABCD-1234-EF56',
        type: FeeType.ADDITION,
        active: true,
        usages: 0,
      });

    const accountWith = (feeIds: number[]): UserData =>
      Object.assign(new UserData(), {
        id: 7,
        accountType: AccountType.PERSONAL,
        individualFees: feeIds.join(';'),
      });

    let manager: MockProxy<EntityManager>;

    beforeEach(() => {
      jest.clearAllMocks();
      settingService.get.mockResolvedValue('100000');

      // Audit, usage counter and assignment share one transaction; run the callback with a manager
      // the assertions can inspect.
      manager = mock<EntityManager>();
      // `manager` is read-only on the repository, so it has to be defined rather than assigned.
      Object.defineProperty(feeRepo, 'manager', {
        value: {
          transaction: jest.fn(async (run: (transactionManager: EntityManager) => Promise<void>) => run(manager)),
        },
        configurable: true,
      });
    });

    it('swaps the fee the account already carries in a single write', async () => {
      const previous = onboardingFee(60, 400);
      const next = onboardingFee(70, 800);
      feeRepo.findOne.mockResolvedValue(next);
      feeRepo.findBy.mockResolvedValue([previous]);

      await service.setOnboardingFee(accountWith([60]), 800);

      // Never remove-then-add: a partial run would leave the account without a fee or with two,
      // and two additive fixed fees are charged as their sum.
      expect(userDataService.replaceFee).toHaveBeenCalledTimes(1);
      expect(userDataService.replaceFee).toHaveBeenCalledWith(expect.anything(), [60], 70, manager);
      expect(userDataService.removeFee).not.toHaveBeenCalled();
      expect(userDataService.addFee).not.toHaveBeenCalled();
    });

    it('counts the assignment on the fee', async () => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([]);

      await service.setOnboardingFee(accountWith([]), 800);

      expect(manager.update).toHaveBeenCalledWith(Fee, 70, expect.objectContaining({ usages: 1 }));
    });

    it('writes the audit entry before touching the assignment', async () => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([onboardingFee(60, 400)]);

      await service.setOnboardingFee(accountWith([60]), 800);

      expect(userDataService.createOnboardingFeeLog).toHaveBeenCalled();
      expect(userDataService.createOnboardingFeeLog.mock.invocationCallOrder[0]).toBeLessThan(
        userDataService.replaceFee.mock.invocationCallOrder[0],
      );
    });

    it('refuses a fee bound to a different wallet', async () => {
      const fee = Object.assign(onboardingFee(70, 800), { wallet: { id: 5 } });
      feeRepo.findOne.mockResolvedValue(fee);
      feeRepo.findBy.mockResolvedValue([]);
      const userData = Object.assign(accountWith([]), { wallet: { id: 9 } });

      await expect(service.setOnboardingFee(userData, 800)).rejects.toThrow(/Wallet not matching/);

      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('refuses a fee the account is not eligible for, before any mutation', async () => {
      const fee = Object.assign(onboardingFee(70, 800), { active: false });
      feeRepo.findOne.mockResolvedValue(fee);
      feeRepo.findBy.mockResolvedValue([]);

      await expect(service.setOnboardingFee(accountWith([]), 800)).rejects.toThrow(/not active/);

      expect(userDataService.createOnboardingFeeLog).not.toHaveBeenCalled();
      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('does nothing when the account already carries exactly that fee', async () => {
      const fee = onboardingFee(70, 800);
      feeRepo.findOne.mockResolvedValue(fee);
      feeRepo.findBy.mockResolvedValue([fee]);

      await service.setOnboardingFee(accountWith([70]), 800);

      expect(userDataService.createOnboardingFeeLog).not.toHaveBeenCalled();
      expect(userDataService.replaceFee).not.toHaveBeenCalled();
      expect(feeRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('creates a fee for an unknown amount and drops the cache so it can be assigned right away', async () => {
      const created = onboardingFee(151, 6200);
      feeRepo.findOne.mockResolvedValue(null);
      feeRepo.create.mockReturnValue(onboardingFee(undefined, 6200));
      feeRepo.save.mockResolvedValue(created);
      feeRepo.findBy.mockResolvedValue([]);
      feeRepo.findCached.mockResolvedValue([created]);

      await service.setOnboardingFee(accountWith([]), 6200);

      expect(feeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: FeeType.ADDITION, rate: 0, fixed: 6200 }),
      );
      expect(feeRepo.invalidateCache).toHaveBeenCalled();
      expect(userDataService.replaceFee).toHaveBeenCalledWith(expect.anything(), [], 151, manager);
    });

    it('never reuses a globally applied fee, and never labels a fee as one-off', async () => {
      const created = onboardingFee(151, 6200);
      feeRepo.findOne.mockResolvedValue(null);
      feeRepo.create.mockReturnValue(onboardingFee(undefined, 6200));
      feeRepo.save.mockResolvedValue(created);
      feeRepo.findBy.mockResolvedValue([]);

      await service.setOnboardingFee(accountWith([]), 6200);

      // `getValidFees` applies an Addition fee without a special code to every user, so only a
      // fee that carries one may be reused or created here.
      expect(feeRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ specialCode: Not(IsNull()) }) }),
      );
      expect(feeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ createSpecialCode: true }));
      // The column defaults to 1, and the blockchain factors of all additive fees are summed into
      // the network fee - a flat CHF surcharge must leave it alone.
      expect(feeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ blockchainFactor: 0 }));
      // Nothing enforces a single use, so the label must not claim one.
      expect(feeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Onboarding Fixed 6200' }));
    });

    it('replaces a restricted flat fee too, even though it would never create one', async () => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([Object.assign(onboardingFee(92, 5000), { assets: '1;2' })]);

      await service.setOnboardingFee(accountWith([92]), 800);

      // Leaving it assigned would charge the customer the sum of both fixed amounts.
      expect(userDataService.replaceFee).toHaveBeenCalledWith(expect.anything(), [92], 70, manager);
      const where = feeRepo.findBy.mock.calls[0][0] as Record<string, unknown>;
      expect(where).not.toHaveProperty('assets');
    });

    it.each([
      ['a rate on top of the fixed amount', { rate: 0.5 }],
      ['a blockchain factor', { blockchainFactor: 1 }],
      ['no special code, so it applies to everyone anyway', { specialCode: undefined }],
    ])('refuses to touch a fixed fee that is not a plain flat surcharge (%s)', async (_name, overrides) => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([Object.assign(onboardingFee(92, 5000), overrides)]);

      await expect(service.setOnboardingFee(accountWith([92]), 800)).rejects.toThrow(ConflictException);

      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('does not count a usage when the account already carries the target fee', async () => {
      const target = onboardingFee(70, 800);
      feeRepo.findOne.mockResolvedValue(target);
      feeRepo.findBy.mockResolvedValue([target, onboardingFee(92, 5000)]);

      await service.setOnboardingFee(accountWith([70, 92]), 800);

      // The fee stays assigned, so nothing was newly taken up - but the extra flat fee goes.
      expect(manager.update).not.toHaveBeenCalled();
      expect(userDataService.replaceFee).toHaveBeenCalledWith(expect.anything(), [70, 92], 70, manager);
    });

    it.each([
      ['deactivated', { active: false }, /fee 88, deactivated/],
      ['restricted', { assets: '1;2' }, /fee 88, differs from a plain flat surcharge/],
    ])('names the fee that blocks the label (%s)', async (_name, overrides, expected) => {
      feeRepo.findOne.mockResolvedValue(null);
      feeRepo.findOneBy.mockResolvedValue(Object.assign(onboardingFee(88, 800), overrides));
      feeRepo.findBy.mockResolvedValue([]);

      // `createFee` would reject the duplicate label with a generic message and no way forward.
      await expect(service.setOnboardingFee(accountWith([]), 800)).rejects.toThrow(ConflictException);
      await expect(service.setOnboardingFee(accountWith([]), 800)).rejects.toThrow(expected);

      expect(feeRepo.save).not.toHaveBeenCalled();
    });

    it('only reuses a fee that carries no filter and no limit at all', async () => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([]);

      await service.setOnboardingFee(accountWith([]), 800);

      // A restricted fee would pass `verifyForUser` on assignment and then be dropped by
      // `verifyForTx` at transaction time - the surcharge would silently never apply.
      const restrictedColumns = [
        'accountType',
        'wallet',
        'bank',
        'assets',
        'excludedAssets',
        'fiats',
        'excludedUserDatas',
        'financialTypes',
        'paymentMethodsIn',
        'paymentMethodsOut',
        'expiryDate',
        'minTxVolume',
        'maxTxVolume',
        'maxAnnualUserTxVolume',
        'maxUsages',
        'maxTxUsages',
        'maxUserTxUsages',
      ];
      const where = feeRepo.findOne.mock.calls[0][0].where as Record<string, unknown>;
      for (const column of restrictedColumns) expect(where[column]).toEqual(IsNull());
    });

    it('falls back to the built-in limit when the setting is not a number', async () => {
      settingService.get.mockResolvedValue('unlimited');
      feeRepo.findBy.mockResolvedValue([]);

      // NaN would make every comparison false and let any amount through.
      await expect(service.setOnboardingFee(accountWith([]), 178000)).rejects.toThrow(/exceeds the limit of 100000/);

      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('only ever matches additive fixed fees, never a percentage or a bank fee', async () => {
      feeRepo.findOne.mockResolvedValue(onboardingFee(70, 800));
      feeRepo.findBy.mockResolvedValue([]);

      await service.setOnboardingFee(accountWith([60, 115]), 800);

      // What is replaced: any additive fee with a fixed amount, since those are what get summed.
      expect(feeRepo.findBy).toHaveBeenCalledWith(
        expect.objectContaining({ type: FeeType.ADDITION, fixed: MoreThan(0) }),
      );
      // What may be reused or created: only an unconditional one.
      expect(feeRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: FeeType.ADDITION, rate: 0, fixed: 800, active: true }),
        }),
      );
    });

    it('rejects an amount above the configured limit without changing anything', async () => {
      settingService.get.mockResolvedValue('100000');

      await expect(service.setOnboardingFee(accountWith([]), 178000)).rejects.toThrow(/exceeds the limit/);

      expect(feeRepo.save).not.toHaveBeenCalled();
      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('refuses to remove anything while a foreign fixed fee is assigned', async () => {
      feeRepo.findBy.mockResolvedValue([Object.assign(onboardingFee(92, 5000), { rate: 0.5 })]);

      await expect(service.removeOnboardingFee(accountWith([92]))).rejects.toThrow(ConflictException);

      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('refuses to remove an onboarding fee from an account that has none', async () => {
      feeRepo.findBy.mockResolvedValue([]);

      await expect(service.removeOnboardingFee(accountWith([]))).rejects.toThrow(/no onboarding fee/);

      expect(userDataService.replaceFee).not.toHaveBeenCalled();
    });

    it('removes every assigned onboarding fee and records it', async () => {
      feeRepo.findBy.mockResolvedValue([onboardingFee(60, 400), onboardingFee(70, 800)]);

      await service.removeOnboardingFee(accountWith([60, 70]));

      const [, loggedFees, replacement, logManager] = userDataService.createOnboardingFeeLog.mock.calls[0];
      expect(loggedFees.map((f) => f.id)).toEqual([60, 70]);
      expect(replacement).toBeUndefined();
      expect(logManager).toBe(manager);
      expect(userDataService.replaceFee).toHaveBeenCalledWith(expect.anything(), [60, 70], undefined, manager);
    });
  });
});
