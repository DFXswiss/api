import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Config, ConfigService } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { RefService } from '../../../referral/process/ref.service';
import { CustodyBalance } from '../../entities/custody-balance.entity';
import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyBalanceRepository } from '../../repositories/custody-balance.repository';
import { CustodyOrderRepository } from '../../repositories/custody-order.repository';
import { CustodyService } from '../custody.service';

describe('CustodyService', () => {
  let service: CustodyService;
  let userDataService: DeepMocked<UserDataService>;
  let custodyOrderRepo: DeepMocked<CustodyOrderRepository>;
  let custodyBalanceRepo: DeepMocked<CustodyBalanceRepository>;
  let assetPricesService: DeepMocked<AssetPricesService>;

  const asset = createCustomAsset({ id: 42, name: 'BTC' });
  const custodyUser = createCustomUser({ id: 7, role: UserRole.CUSTODY });
  const accountId = 100;

  beforeAll(() => new ConfigService());

  beforeEach(() => {
    userDataService = createMock<UserDataService>();
    custodyOrderRepo = createMock<CustodyOrderRepository>();
    custodyBalanceRepo = createMock<CustodyBalanceRepository>();
    assetPricesService = createMock<AssetPricesService>();

    service = new CustodyService(
      createMock<UserService>(),
      userDataService,
      createMock<WalletService>(),
      createMock<RefService>(),
      createMock<AuthService>(),
      custodyOrderRepo,
      custodyBalanceRepo,
      assetPricesService,
      createMock<AssetService>(),
    );

    userDataService.getUserData.mockResolvedValue(
      Object.assign(new UserData(), { id: accountId, users: [custodyUser] }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function depositOrder(updated: Date, amount: number): CustodyOrder {
    return Object.assign(new CustodyOrder(), {
      id: 1,
      type: CustodyOrderType.DEPOSIT,
      status: CustodyOrderStatus.COMPLETED,
      inputAmount: amount,
      inputAsset: asset,
      user: custodyUser,
      updated,
    });
  }

  function assetPrice(created: Date, priceChf: number, priceEur: number, priceUsd: number): AssetPrice {
    return Object.assign(new AssetPrice(), {
      id: created.getTime(),
      asset,
      created,
      priceChf,
      priceEur,
      priceUsd,
    });
  }

  describe('getUserCustodyHistory', () => {
    it('throws when the account is missing', async () => {
      userDataService.getUserData.mockResolvedValue(null);

      await expect(service.getUserCustodyHistory(accountId)).rejects.toThrow(NotFoundException);
    });

    it('returns an empty history when there are no completed orders', async () => {
      custodyOrderRepo.find.mockResolvedValue([]);

      await expect(service.getUserCustodyHistory(accountId)).resolves.toEqual({ totalValue: [] });
    });

    it('uses a single price row per asset unchanged (balance × price)', async () => {
      const balance = 2;
      const priceChf = 100;
      const priceEur = 90;
      const priceUsd = 110;

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([
        assetPrice(new Date('2025-11-01T09:00:00.000Z'), priceChf, priceEur, priceUsd),
      ]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      expect(result.totalValue[0].value).toEqual({
        chf: balance * priceChf,
        eur: balance * priceEur,
        usd: balance * priceUsd,
      });
    });

    it('uses the latest price per asset when multiple price rows fall on the same UTC day', async () => {
      const balance = 2;
      // Later timestamp first in the array — selection must use created, not array order.
      const laterPrice = assetPrice(new Date('2025-11-01T23:01:00.000Z'), 150, 140, 160);
      const earlierPrice = assetPrice(new Date('2025-11-01T09:00:00.000Z'), 100, 90, 110);

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([laterPrice, earlierPrice]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      // Must be balance × later price (300), not the sum of both (500).
      expect(result.totalValue[0].value).toEqual({
        chf: balance * laterPrice.priceChf,
        eur: balance * laterPrice.priceEur,
        usd: balance * laterPrice.priceUsd,
      });
    });

    it('uses the higher id when two price rows share the same created timestamp', async () => {
      const balance = 2;
      const created = new Date('2025-11-01T09:00:00.000Z');
      // Lower id first in the array — selection must use higher id, not array order.
      const lowerIdPrice = Object.assign(assetPrice(created, 100, 90, 110), { id: 1 });
      const higherIdPrice = Object.assign(assetPrice(created, 150, 140, 160), { id: 2 });

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([lowerIdPrice, higherIdPrice]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      // Must be balance × higher-id price (300), not the lower-id price (200).
      expect(result.totalValue[0].value).toEqual({
        chf: balance * higherIdPrice.priceChf,
        eur: balance * higherIdPrice.priceEur,
        usd: balance * higherIdPrice.priceUsd,
      });
    });
  });

  describe('getUserCustodyBalance', () => {
    it('throws when the account is missing', async () => {
      userDataService.getUserData.mockResolvedValue(null);

      await expect(service.getUserCustodyBalance(accountId)).rejects.toThrow(NotFoundException);
    });

    it('attaches interest and interestValue only to the saving position; totalValue stays unchanged', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-28T00:00:00.000Z'));

      const savingAsset = createCustomAsset({
        id: 60,
        name: 'sZCHF',
        uniqueName: Config.custody.savingAsset,
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const otherAsset = createCustomAsset({
        id: 61,
        name: 'BTC',
        uniqueName: 'Bitcoin/BTC',
        approxPriceChf: 50000,
        approxPriceEur: 46000,
        approxPriceUsd: 55000,
      });

      custodyBalanceRepo.findBy.mockResolvedValue([
        Object.assign(new CustodyBalance(), { asset: savingAsset, balance: 1000, user: custodyUser }),
        Object.assign(new CustodyBalance(), { asset: otherAsset, balance: 0.1, user: custodyUser }),
      ]);

      custodyOrderRepo.find.mockResolvedValue([
        Object.assign(new CustodyOrder(), {
          id: 1,
          type: CustodyOrderType.DEPOSIT,
          status: CustodyOrderStatus.COMPLETED,
          inputAmount: 99500,
          inputAsset: savingAsset,
          user: custodyUser,
          updated: new Date('2026-01-28T00:00:00.000Z'),
          completedAt: new Date('2026-01-28T00:00:00.000Z'),
        }),
      ]);

      const result = await service.getUserCustodyBalance(accountId);

      const szchfDto = result.balances.find((b) => b.asset.name === 'sZCHF');
      const btcDto = result.balances.find((b) => b.asset.name === 'BTC');

      expect(szchfDto.value).toEqual({ chf: 1000, eur: 1000, usd: 1000 });
      expect(szchfDto.interest).toBeCloseTo(1726.94, 2);
      expect(szchfDto.interestValue).toEqual({
        chf: expect.closeTo(1726.94, 2),
        eur: expect.closeTo(1726.94, 2),
        usd: expect.closeTo(1726.94, 2),
      });

      expect(btcDto.value).toEqual({ chf: 5000, eur: 4600, usd: 5500 });
      expect(btcDto.interest).toBeUndefined();
      expect(btcDto.interestValue).toBeUndefined();

      // totalValue must reflect only booked balances (curr.value), never the accrued interest —
      // getUserCustodyHistory() has no notion of interest, so including it here would make the
      // displayed figure jump against the history chart.
      expect(result.totalValue).toEqual({ chf: 6000, eur: 5600, usd: 6500 });
    });

    it('keeps all positions with correct value, drops interest, and logs when it throws', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-28T00:00:00.000Z'));

      const savingAsset = createCustomAsset({
        id: 60,
        name: 'sZCHF',
        uniqueName: Config.custody.savingAsset,
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const otherAsset = createCustomAsset({
        id: 61,
        name: 'BTC',
        uniqueName: 'Bitcoin/BTC',
        approxPriceChf: 50000,
        approxPriceEur: 46000,
        approxPriceUsd: 55000,
      });

      custodyBalanceRepo.findBy.mockResolvedValue([
        Object.assign(new CustodyBalance(), { asset: savingAsset, balance: 1000, user: custodyUser }),
        Object.assign(new CustodyBalance(), { asset: otherAsset, balance: 0.1, user: custodyUser }),
      ]);

      // Completed order for the saving asset without completedAt is a real data error —
      // calculateAccruedInterest() throws on it (see accrueTranche()).
      custodyOrderRepo.find.mockResolvedValue([
        Object.assign(new CustodyOrder(), {
          id: 1,
          type: CustodyOrderType.DEPOSIT,
          status: CustodyOrderStatus.COMPLETED,
          inputAmount: 99500,
          inputAsset: savingAsset,
          user: custodyUser,
          updated: new Date('2026-01-28T00:00:00.000Z'),
        }),
      ]);

      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const result = await service.getUserCustodyBalance(accountId);

      const szchfDto = result.balances.find((b) => b.asset.name === 'sZCHF');
      const btcDto = result.balances.find((b) => b.asset.name === 'BTC');

      expect(szchfDto.value).toEqual({ chf: 1000, eur: 1000, usd: 1000 });
      expect(szchfDto.interest).toBeUndefined();
      expect(szchfDto.interestValue).toBeUndefined();

      expect(btcDto.value).toEqual({ chf: 5000, eur: 4600, usd: 5500 });
      expect(btcDto.interest).toBeUndefined();
      expect(btcDto.interestValue).toBeUndefined();

      expect(result.totalValue).toEqual({ chf: 6000, eur: 5600, usd: 6500 });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to calculate accrued interest'),
        expect.any(Error),
      );
    });
  });

  describe('calculateAccruedInterest', () => {
    let rate: number;

    beforeAll(() => {
      rate = Config.custody.savingInterestRate;
    });

    const dueDate = new Date('2026-07-28T00:00:00.000Z');
    const userIds = [custodyUser.id];

    function interestOrder(params: {
      completedAt: Date;
      inputAmount?: number | null;
      outputAmount?: number | null;
      id?: number;
    }): CustodyOrder {
      return Object.assign(new CustodyOrder(), {
        id: params.id ?? 1,
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.COMPLETED,
        inputAmount: params.inputAmount,
        inputAsset: params.inputAmount !== undefined ? asset : undefined,
        outputAmount: params.outputAmount,
        outputAsset: params.outputAmount !== undefined ? asset : undefined,
        user: custodyUser,
        updated: params.completedAt,
        completedAt: params.completedAt,
      });
    }

    it('calculates simple interest for a single tranche over 181 days', async () => {
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ completedAt: new Date('2026-01-28T00:00:00.000Z'), inputAmount: 99500 }),
      ]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(result).toBeCloseTo(1726.94, 2);
    });

    it('sums interest across two tranches with different value dates', async () => {
      const amount1 = 50000;
      const amount2 = 25000;
      const completedAt1 = new Date('2026-01-28T00:00:00.000Z');
      const completedAt2 = new Date('2026-04-01T00:00:00.000Z');
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ id: 1, completedAt: completedAt1, inputAmount: amount1 }),
        interestOrder({ id: 2, completedAt: completedAt2, inputAmount: amount2 }),
      ]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      const expected =
        amount1 * rate * Util.yearsDiff(completedAt1, dueDate) + amount2 * rate * Util.yearsDiff(completedAt2, dueDate);

      expect(result).toBeCloseTo(expected, 2);
    });

    it('matches a hand-computed value for two tranches (anchored independently of Util.yearsDiff)', async () => {
      // 99500 * 0.035 * 181/365 = 1726.9383561643838
      // 50000 * 0.035 * 118/365 =  565.7534246575343
      // sum                     = 2292.691780821918 -> 2292.69
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ id: 1, completedAt: new Date('2026-01-28T00:00:00.000Z'), inputAmount: 99500 }),
        interestOrder({ id: 2, completedAt: new Date('2026-04-01T00:00:00.000Z'), inputAmount: 50000 }),
      ]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(result).toBeCloseTo(2292.69, 2);
    });

    it('reduces interest for a negative tranche from its own value date', async () => {
      const depositAmount = 99500;
      const withdrawalAmount = 20000;
      const depositCompletedAt = new Date('2026-01-28T00:00:00.000Z');
      const withdrawalCompletedAt = new Date('2026-04-01T00:00:00.000Z');
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ id: 1, completedAt: depositCompletedAt, inputAmount: depositAmount }),
        interestOrder({ id: 2, completedAt: withdrawalCompletedAt, outputAmount: withdrawalAmount }),
      ]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      const depositYears = Util.yearsDiff(depositCompletedAt, dueDate);
      const withdrawalYears = Util.yearsDiff(withdrawalCompletedAt, dueDate);
      const expected = depositAmount * rate * depositYears - withdrawalAmount * rate * withdrawalYears;
      const depositOnly = depositAmount * rate * depositYears;

      expect(result).toBeCloseTo(expected, 2);
      expect(result).toBeLessThan(depositOnly);
    });

    it('ignores orders with value date after dueDate', async () => {
      const afterDueDate = new Date('2026-07-29T00:00:00.000Z');
      custodyOrderRepo.find.mockResolvedValue([interestOrder({ completedAt: afterDueDate, inputAmount: 99500 })]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(result).toBe(0);
    });

    it('passes COMPLETED status filter in both where conditions', async () => {
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ completedAt: new Date('2026-01-28T00:00:00.000Z'), inputAmount: 1000 }),
      ]);

      await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(custodyOrderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({ status: CustodyOrderStatus.COMPLETED }),
            expect.objectContaining({ status: CustodyOrderStatus.COMPLETED }),
          ]),
        }),
      );
    });

    it('excludes COMPLETED orders with null amounts from interest', async () => {
      const validOrder = interestOrder({ completedAt: new Date('2026-01-28T00:00:00.000Z'), inputAmount: 1000 });
      const nullAmountOrder = interestOrder({
        id: 2,
        completedAt: new Date('2026-01-28T00:00:00.000Z'),
        inputAmount: null,
      });

      custodyOrderRepo.find.mockResolvedValueOnce([validOrder]);
      const withoutNull = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      custodyOrderRepo.find.mockResolvedValueOnce([validOrder, nullAmountOrder]);
      const withNull = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(withNull).toBe(withoutNull);
      expect(withNull).not.toBeNaN();
    });

    it('throws when a Completed order has no completedAt', async () => {
      const orderWithoutCompletedAt = Object.assign(new CustodyOrder(), {
        id: 7,
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.COMPLETED,
        inputAmount: 1000,
        inputAsset: asset,
        user: custodyUser,
        updated: new Date('2026-01-28T00:00:00.000Z'),
      });
      custodyOrderRepo.find.mockResolvedValue([orderWithoutCompletedAt]);

      await expect((service as any).calculateAccruedInterest(userIds, asset, dueDate)).rejects.toThrow(/7/);
    });

    it('throws when an order amount is not finite (Infinity)', async () => {
      const nonFiniteOrder = interestOrder({
        id: 8,
        completedAt: new Date('2026-01-28T00:00:00.000Z'),
        inputAmount: Infinity,
      });
      custodyOrderRepo.find.mockResolvedValue([nonFiniteOrder]);

      await expect((service as any).calculateAccruedInterest(userIds, asset, dueDate)).rejects.toThrow(/8/);
    });

    it('throws when completedAt is an Invalid Date instead of silently yielding zero interest', async () => {
      const invalidDateOrder = interestOrder({
        completedAt: new Date('not-a-real-date'),
        inputAmount: 1000,
      });
      custodyOrderRepo.find.mockResolvedValue([invalidDateOrder]);

      await expect((service as any).calculateAccruedInterest(userIds, asset, dueDate)).rejects.toThrow(
        /invalid completedAt/i,
      );
    });

    it('clamps a negative total to 0 and logs an error instead of returning a negative value', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ id: 1, completedAt: new Date('2026-01-28T00:00:00.000Z'), inputAmount: 1000 }),
        interestOrder({ id: 2, completedAt: new Date('2026-01-28T00:00:00.000Z'), outputAmount: 50000 }),
      ]);

      const result = await (service as any).calculateAccruedInterest(userIds, asset, dueDate);

      expect(result).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Negative accrued interest'));
    });

    it('throws when a single tranche overflows to a non-finite value', async () => {
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ completedAt: new Date('1900-01-01T00:00:00.000Z'), inputAmount: Number.MAX_VALUE }),
      ]);

      await expect((service as any).calculateAccruedInterest(userIds, asset, dueDate)).rejects.toThrow(
        /non-finite tranche/i,
      );
    });

    it('throws when individually finite tranches sum to a non-finite total', async () => {
      custodyOrderRepo.find.mockResolvedValue([
        interestOrder({ id: 1, completedAt: new Date('2000-01-01T00:00:00.000Z'), inputAmount: Number.MAX_VALUE }),
        interestOrder({ id: 2, completedAt: new Date('2000-01-01T00:00:00.000Z'), inputAmount: Number.MAX_VALUE }),
      ]);

      await expect((service as any).calculateAccruedInterest(userIds, asset, dueDate)).rejects.toThrow(
        /non-finite accrued interest total/i,
      );
    });
  });

  describe('hasNonZeroCustodyBalance', () => {
    it('returns false without querying when there are no custody user ids', async () => {
      const result = await service.hasNonZeroCustodyBalance([]);

      expect(result).toBe(false);
      expect(custodyBalanceRepo.exists).not.toHaveBeenCalled();
    });

    it('returns false when no balance row is non-zero', async () => {
      custodyBalanceRepo.exists.mockResolvedValue(false);

      const result = await service.hasNonZeroCustodyBalance([7]);

      expect(result).toBe(false);
    });

    it('returns true when a non-zero balance exists', async () => {
      custodyBalanceRepo.exists.mockResolvedValue(true);

      const result = await service.hasNonZeroCustodyBalance([7]);

      expect(result).toBe(true);
      expect(custodyBalanceRepo.exists).toHaveBeenCalledTimes(1);
    });

    it('builds a sign-agnostic Not(0) condition, not a separate negative branch (shape only)', async () => {
      await service.hasNonZeroCustodyBalance([7]);

      const call = custodyBalanceRepo.exists.mock.calls[0][0];
      const balanceCondition = call.where as { user: { id: unknown }; balance: { type: string; value: number } };

      // Not(0) matches any value that isn't exactly 0, positive or negative alike — there is no
      // separate branch for negative balances, so this single condition already covers them.
      // This only checks the shape of the query condition; no real negative value is evaluated
      // here (the method just assembles a query and passes the DB result through).
      expect(balanceCondition.balance.type).toBe('not');
      expect(balanceCondition.balance.value).toBe(0);
    });
  });
});
