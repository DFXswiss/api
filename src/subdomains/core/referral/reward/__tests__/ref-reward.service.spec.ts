import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';
import { RefRewardService } from '../services/ref-reward.service';

function mockRawQueryBuilder(rawResult: any) {
  const qb: any = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(rawResult),
    getRawMany: jest.fn().mockResolvedValue(rawResult),
  };
  return qb;
}

describe('RefRewardService', () => {
  let service: RefRewardService;

  let rewardRepo: RefRewardRepository;
  let userService: UserService;
  let pricingService: PricingService;
  let assetService: AssetService;
  let transactionService: TransactionService;
  let settingService: SettingService;

  beforeEach(async () => {
    rewardRepo = createMock<RefRewardRepository>();
    userService = createMock<UserService>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();
    transactionService = createMock<TransactionService>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefRewardService,
        { provide: RefRewardRepository, useValue: rewardRepo },
        { provide: UserService, useValue: userService },
        { provide: PricingService, useValue: pricingService },
        { provide: AssetService, useValue: assetService },
        { provide: TransactionService, useValue: transactionService },
        { provide: SettingService, useValue: settingService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<RefRewardService>(RefRewardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOpenRefCreditLiability', () => {
    it('converts the open EUR credit to CHF', async () => {
      jest.spyOn(userService, 'getOpenRefCreditEur').mockResolvedValue(1000);
      const convert = jest.fn().mockReturnValue(920);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert } as any);

      const result = await service.getOpenRefCreditLiability();

      expect(result).toEqual({ amountEur: 1000, amountChf: 920 });
      expect(convert).toHaveBeenCalledWith(1000, 8);
    });

    it('returns zero without fetching a price when nothing is owed', async () => {
      jest.spyOn(userService, 'getOpenRefCreditEur').mockResolvedValue(0);
      const getPrice = jest.spyOn(pricingService, 'getPrice');

      const result = await service.getOpenRefCreditLiability();

      expect(result).toEqual({ amountEur: 0, amountChf: 0 });
      expect(getPrice).not.toHaveBeenCalled();
    });
  });

  describe('createRefBonusRewards', () => {
    const agreement = {
      usedRef: 'AAA-000',
      userId: 1,
      outputAssetId: 2,
      feeShare: 0.5,
      minTransactionId: 0,
    };

    const user = {
      id: 1,
      address: '0x0000000000000000000000000000000000000001',
      ref: 'AAA-000',
      refVolume: 0,
      refCredit: 0,
      refFeePercent: 1,
      userData: { id: 10 },
    } as any;

    const asset = { id: 2, blockchain: 'Ethereum' } as any;

    function mockAgreementsSetup(agreements: any[] = [agreement]) {
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refBonusAgreements') return agreements;
        if (key === 'refRewardManualCheckLimit') return defaultValue;
        return defaultValue;
      });
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);
    }

    it('does nothing when no agreements are configured', async () => {
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? [] : defaultValue,
        );

      await service.createRefBonusRewards();

      expect(transactionService.getRefBonusCandidates).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('saves amountInEur as the configured share of an EUR fee', async () => {
      const agreements = [agreement];
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? agreements : defaultValue,
        );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: 6200, inputReferenceAsset: 'EUR' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 3100 }));
    });

    it('converts a non-EUR fee before applying the fee share', async () => {
      const agreements = [agreement];
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? agreements : defaultValue,
        );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: any) => {
        if (from === 'CHF') {
          return { convert: (amount: number) => amount * 0.95 } as any;
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: 800, inputReferenceAsset: 'CHF' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 380 }));
    });

    it('continues processing remaining candidates when one price lookup fails', async () => {
      const agreements = [agreement];
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? agreements : defaultValue,
        );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: any) => {
        if (from === 'CHF') {
          return Promise.reject(new Error('price unavailable'));
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 200,
          buyCrypto: { absoluteFeeAmount: 800, inputReferenceAsset: 'CHF' },
        },
        {
          id: 201,
          buyCrypto: { absoluteFeeAmount: 6200, inputReferenceAsset: 'EUR' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledTimes(1);
      expect(rewardRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amountInEur: 3100,
          sourceTransaction: expect.objectContaining({ id: 201 }),
        }),
      );
    });

    it('converts a sell-side crypto fee via the cryptoInput asset before applying the fee share', async () => {
      const agreements = [agreement];
      const feeAsset = { id: 3, name: 'BTC' } as any;
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? agreements : defaultValue,
        );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: any) => {
        if (from === feeAsset) {
          return { convert: (amount: number) => amount * 100 } as any;
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyFiat: {
            absoluteFeeAmount: 5,
            cryptoInput: { asset: feeAsset },
          },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      // fee 5 * 100 EUR = 500, feeShare 0.5 -> amountInEur 250
      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 250 }));
    });

    it('skips a sell-side candidate when cryptoInput asset is missing', async () => {
      const agreements = [agreement];
      jest
        .spyOn(settingService, 'getObj')
        .mockImplementation(async (key: string, defaultValue?: any) =>
          key === 'refBonusAgreements' ? agreements : defaultValue,
        );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyFiat: {
            absoluteFeeAmount: 5,
            cryptoInput: undefined,
          },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips agreement when the referenced user is missing', async () => {
      mockAgreementsSetup();
      jest.spyOn(userService, 'getUser').mockResolvedValue(undefined as any);

      await service.createRefBonusRewards();

      expect(transactionService.getRefBonusCandidates).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips agreement when the referenced output asset is missing', async () => {
      mockAgreementsSetup();
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(undefined as any);

      await service.createRefBonusRewards();

      expect(transactionService.getRefBonusCandidates).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips agreement when the output asset is on a chain the address cannot serve', async () => {
      mockAgreementsSetup();
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue({ id: 2, blockchain: 'Bitcoin' } as any);

      await service.createRefBonusRewards();

      expect(transactionService.getRefBonusCandidates).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips agreement when the recipient has no referral code', async () => {
      mockAgreementsSetup();
      jest.spyOn(userService, 'getUser').mockResolvedValue({ ...user, ref: undefined } as any);

      await service.createRefBonusRewards();

      expect(transactionService.getRefBonusCandidates).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips a candidate that carries a fee on neither buyCrypto nor buyFiat', async () => {
      mockAgreementsSetup();
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
        },
      ] as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips a candidate whose computed amount is exactly zero', async () => {
      mockAgreementsSetup();
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: 0, inputReferenceAsset: 'EUR' },
        },
      ] as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips a candidate whose computed amount is negative', async () => {
      mockAgreementsSetup();
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: -100, inputReferenceAsset: 'EUR' },
        },
      ] as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips a candidate whose computed amount is not finite', async () => {
      mockAgreementsSetup();
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: Infinity, inputReferenceAsset: 'EUR' },
        },
      ] as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('marks a reward MANUAL_CHECK when the computed amount exceeds the manual-check limit', async () => {
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refBonusAgreements') return [agreement];
        if (key === 'refRewardManualCheckLimit') return 1000;
        return defaultValue;
      });
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          // feeShare 0.5 -> amountInEur 1500 > 1000
          buyCrypto: { absoluteFeeAmount: 3000, inputReferenceAsset: 'EUR' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: RewardStatus.MANUAL_CHECK, amountInEur: 1500 }),
      );
    });

    it('marks a reward PREPARED when the computed amount is at or below the manual-check limit', async () => {
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refBonusAgreements') return [agreement];
        if (key === 'refRewardManualCheckLimit') return 1000;
        return defaultValue;
      });
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          // feeShare 0.5 -> amountInEur 500 <= 1000
          buyCrypto: { absoluteFeeAmount: 1000, inputReferenceAsset: 'EUR' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: RewardStatus.PREPARED, amountInEur: 500 }),
      );
    });

    it('accumulates the referral credit across multiple candidates in one run', async () => {
      mockAgreementsSetup();
      // The service mutates `user.refVolume`/`user.refCredit` in place across candidates, and this
      // `user` fixture is shared by every test in this describe block. Reset it explicitly so this
      // assertion is not sensitive to leftover mutations from tests that ran earlier.
      user.refVolume = 0;
      user.refCredit = 0;
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: 100, inputReferenceAsset: 'EUR' },
        },
        {
          id: 101,
          buyCrypto: { absoluteFeeAmount: 40, inputReferenceAsset: 'EUR' },
        },
      ] as any);

      await service.createRefBonusRewards();

      // updateRefVolume writes absolute totals, not deltas; a non-accumulated call would overwrite
      // the first candidate's bonus with the second candidate's bonus instead of adding to it.
      expect(rewardRepo.save).toHaveBeenCalledTimes(2);
      expect(userService.updateRefVolume).toHaveBeenCalledTimes(2);
      expect(userService.updateRefVolume).toHaveBeenLastCalledWith(user.ref, 70, 70);
    });

    it('does not update the referral credit when saving the reward fails', async () => {
      mockAgreementsSetup();
      jest.spyOn(transactionService, 'getRefBonusCandidates').mockResolvedValue([
        {
          id: 100,
          buyCrypto: { absoluteFeeAmount: 100, inputReferenceAsset: 'EUR' },
        },
      ] as any);
      jest.spyOn(rewardRepo, 'save').mockRejectedValue(new Error('save failed'));

      // A credit increase without a persisted reward would be granted again on the next run, since
      // the candidate keeps being selected until a reward is actually stored for it.
      await service.createRefBonusRewards();

      expect(userService.updateRefVolume).not.toHaveBeenCalled();
    });
  });

  describe('createPendingRefRewards', () => {
    const ethAddress = 'eth-addr-1';
    const ethDefaultAsset = { id: 10, blockchain: Blockchain.ETHEREUM } as any;
    const btcDefaultAsset = { id: 20, blockchain: Blockchain.BITCOIN } as any;

    function openCreditUser(overrides: Record<string, unknown> = {}) {
      return {
        id: 1,
        address: ethAddress,
        totalRefCredit: 50,
        paidRefCredit: 0,
        refAsset: undefined,
        userData: { id: 10 },
        ...overrides,
      } as any;
    }

    function setupPendingHappyPath(users: any[]) {
      jest.spyOn(userService, 'getOpenRefCreditUser').mockResolvedValue(users);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(rewardRepo, 'findOne').mockResolvedValue(null as any);
      jest.spyOn(assetService, 'getRefPayoutAsset').mockImplementation(async (blockchain: Blockchain) => {
        if (blockchain === Blockchain.ETHEREUM) return ethDefaultAsset;
        if (blockchain === Blockchain.BITCOIN) return btcDefaultAsset;
        return { id: 99, blockchain } as any;
      });
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refRewardManualCheckLimit') return 3000;
        return defaultValue;
      });
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);
      jest.spyOn(CryptoService, 'getDefaultBlockchainBasedOn').mockImplementation((address: string) => {
        if (address.startsWith('btc')) return Blockchain.BITCOIN;
        if (address.startsWith('dfi')) return Blockchain.DEFICHAIN;
        return Blockchain.ETHEREUM;
      });
    }

    afterEach(() => {
      jest.spyOn(CryptoService, 'getDefaultBlockchainBasedOn').mockRestore();
    });

    it('returns immediately when there is no open-credit user', async () => {
      jest.spyOn(userService, 'getOpenRefCreditUser').mockResolvedValue([]);
      const getPrice = jest.spyOn(pricingService, 'getPrice');
      const findOne = jest.spyOn(rewardRepo, 'findOne');

      await service.createPendingRefRewards();

      expect(getPrice).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
    });

    it('skips a blockchain group that already has a pending reward', async () => {
      setupPendingHappyPath([openCreditUser()]);
      jest.spyOn(rewardRepo, 'findOne').mockResolvedValue({ id: 1 } as any);
      const getRefPayoutAsset = jest.spyOn(assetService, 'getRefPayoutAsset');

      await service.createPendingRefRewards();

      expect(getRefPayoutAsset).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('falls back to the default payout asset when the user has no ref asset configured', async () => {
      setupPendingHappyPath([openCreditUser({ refAsset: undefined, totalRefCredit: 50, paidRefCredit: 0 })]);

      await service.createPendingRefRewards();

      expect(rewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          outputAsset: ethDefaultAsset,
          status: RewardStatus.PREPARED,
          amountInEur: 50,
        }),
      );
      expect(rewardRepo.save).toHaveBeenCalled();
    });

    it("uses the user's own ref asset when configured, even though the default asset is also fetched", async () => {
      const userRefAsset = { id: 11, blockchain: Blockchain.ETHEREUM } as any;
      setupPendingHappyPath([openCreditUser({ refAsset: userRefAsset, totalRefCredit: 50, paidRefCredit: 0 })]);

      await service.createPendingRefRewards();

      expect(rewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          outputAsset: userRefAsset,
        }),
      );
      expect(assetService.getRefPayoutAsset).toHaveBeenCalledWith(Blockchain.ETHEREUM);
    });

    it("throws when the resolved payout asset's blockchain does not match the target blockchain", async () => {
      const mismatchedAsset = { id: 12, blockchain: Blockchain.BITCOIN } as any;
      setupPendingHappyPath([openCreditUser({ refAsset: mismatchedAsset, totalRefCredit: 50, paidRefCredit: 0 })]);

      await expect(service.createPendingRefRewards()).rejects.toThrow('User ref asset blockchain mismatch');
    });

    it("skips a user whose open ref credit is below the blockchain's minimum payout", async () => {
      // ETHEREUM min = 10; open credit 5
      setupPendingHappyPath([openCreditUser({ totalRefCredit: 5, paidRefCredit: 0 })]);

      await service.createPendingRefRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('skips every user on a blockchain with no configured payout minimum', async () => {
      setupPendingHappyPath([
        openCreditUser({
          address: 'dfi-addr-1',
          totalRefCredit: 9999,
          paidRefCredit: 0,
          refAsset: { id: 30, blockchain: Blockchain.DEFICHAIN },
        }),
      ]);

      await service.createPendingRefRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('marks a reward MANUAL_CHECK when open ref credit exceeds the manual-check limit', async () => {
      setupPendingHappyPath([openCreditUser({ totalRefCredit: 5000, paidRefCredit: 0 })]);
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refRewardManualCheckLimit') return 3000;
        return defaultValue;
      });

      await service.createPendingRefRewards();

      expect(rewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: RewardStatus.MANUAL_CHECK,
          amountInEur: 5000,
        }),
      );
    });

    it('marks a reward PREPARED when open ref credit is at or below the manual-check limit', async () => {
      setupPendingHappyPath([openCreditUser({ totalRefCredit: 100, paidRefCredit: 0 })]);
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) => {
        if (key === 'refRewardManualCheckLimit') return 3000;
        return defaultValue;
      });

      await service.createPendingRefRewards();

      expect(rewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: RewardStatus.PREPARED,
          amountInEur: 100,
        }),
      );
    });

    it('processes multiple users across multiple blockchain groups independently', async () => {
      const users = [
        openCreditUser({ id: 1, address: 'eth-addr-1', totalRefCredit: 50, paidRefCredit: 0 }),
        openCreditUser({ id: 2, address: 'eth-addr-2', totalRefCredit: 60, paidRefCredit: 0 }),
        openCreditUser({
          id: 3,
          address: 'btc-addr-1',
          totalRefCredit: 200,
          paidRefCredit: 0,
          refAsset: { id: 21, blockchain: Blockchain.BITCOIN },
        }),
        openCreditUser({
          id: 4,
          address: 'btc-addr-2',
          totalRefCredit: 250,
          paidRefCredit: 0,
          refAsset: { id: 22, blockchain: Blockchain.BITCOIN },
        }),
      ];
      setupPendingHappyPath(users);

      await service.createPendingRefRewards();

      expect(rewardRepo.findOne).toHaveBeenCalledTimes(2);
      expect(assetService.getRefPayoutAsset).toHaveBeenCalledTimes(2);
      expect(assetService.getRefPayoutAsset).toHaveBeenCalledWith(Blockchain.ETHEREUM);
      expect(assetService.getRefPayoutAsset).toHaveBeenCalledWith(Blockchain.BITCOIN);
      expect(rewardRepo.save).toHaveBeenCalledTimes(4);
    });
  });

  describe('updateVolumes', () => {
    it('delegates to updatePaidRefCredit with the ids of all users', async () => {
      jest.spyOn(userService, 'getAllUser').mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
      const updatePaidRefCredit = jest.spyOn(service, 'updatePaidRefCredit').mockResolvedValue(undefined);

      await service.updateVolumes();

      expect(updatePaidRefCredit).toHaveBeenCalledWith([1, 2]);
    });
  });

  describe('updateRefReward', () => {
    it('throws when the reward does not exist', async () => {
      jest.spyOn(rewardRepo, 'findOneBy').mockResolvedValue(null as any);

      await expect(service.updateRefReward(1, { status: RewardStatus.PREPARED } as any)).rejects.toThrow(
        'RefReward not found',
      );
    });

    it('throws BadRequestException when the reward is already COMPLETE', async () => {
      jest.spyOn(rewardRepo, 'findOneBy').mockResolvedValue({ id: 1, status: RewardStatus.COMPLETE } as any);

      await expect(service.updateRefReward(1, { status: RewardStatus.PREPARED } as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateRefReward(1, { status: RewardStatus.PREPARED } as any)).rejects.toThrow(
        'RefReward already complete',
      );
    });

    it('updates and saves the reward when it is neither COMPLETE nor PAYING_OUT', async () => {
      const entity = { id: 1, status: RewardStatus.PREPARED } as any;
      jest.spyOn(rewardRepo, 'findOneBy').mockResolvedValue(entity);
      jest.spyOn(rewardRepo, 'save').mockImplementation(async (e) => e as any);

      const result = await service.updateRefReward(1, { status: RewardStatus.READY_FOR_PAYOUT } as any);

      expect(rewardRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, status: RewardStatus.READY_FOR_PAYOUT }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 1, status: RewardStatus.READY_FOR_PAYOUT }));
    });
  });

  describe('getAllUserRewards', () => {
    it('fetches rewards for the given user ids ordered by id descending', async () => {
      const rewards = [{ id: 2 }, { id: 1 }] as any;
      jest.spyOn(rewardRepo, 'find').mockResolvedValue(rewards);

      const result = await service.getAllUserRewards([1, 2]);

      expect(rewardRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user: { id: expect.anything() } },
          relations: { user: true },
          order: { id: 'DESC' },
        }),
      );
      const findArg = (rewardRepo.find as jest.Mock).mock.calls[0][0];
      expect(findArg.where.user.id.value).toEqual([1, 2]);
      expect(result).toBe(rewards);
    });
  });

  describe('getRefRewardsByUserDataId', () => {
    it('fetches rewards for the given userDataId ordered by id descending', async () => {
      const rewards = [{ id: 5 }] as any;
      jest.spyOn(rewardRepo, 'find').mockResolvedValue(rewards);

      const result = await service.getRefRewardsByUserDataId(10);

      expect(rewardRepo.find).toHaveBeenCalledWith({
        where: { user: { userData: { id: 10 } } },
        relations: { user: true },
        order: { id: 'DESC' },
      });
      expect(result).toBe(rewards);
    });
  });

  describe('getRefRewardVolume', () => {
    it('sums the ref reward volume since a given date', async () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const qb = mockRawQueryBuilder({ volume: 123.45 });
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);

      const result = await service.getRefRewardVolume(from);

      expect(result).toBe(123.45);
      expect(qb.where).toHaveBeenCalledWith('refReward.created >= :from', { from });
    });

    it('returns zero when there is no volume yet', async () => {
      const qb = mockRawQueryBuilder({ volume: null });
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);

      const result = await service.getRefRewardVolume(new Date(0));

      expect(result).toBe(0);
    });
  });

  describe('updatePaidRefCredit', () => {
    it('does nothing when the id list is empty', async () => {
      const createQueryBuilder = jest.spyOn(rewardRepo, 'createQueryBuilder');
      const updatePaidRefCredit = jest.spyOn(userService, 'updatePaidRefCredit');

      await service.updatePaidRefCredit([]);

      expect(createQueryBuilder).not.toHaveBeenCalled();
      expect(updatePaidRefCredit).not.toHaveBeenCalled();
    });

    it('deduplicates and drops falsy ids before querying', async () => {
      const qb = mockRawQueryBuilder({ volume: 10 });
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);
      jest.spyOn(userService, 'updatePaidRefCredit').mockResolvedValue(undefined as any);

      await service.updatePaidRefCredit([1, 1, 0, 2]);

      expect(userService.updatePaidRefCredit).toHaveBeenCalledTimes(2);
      expect(userService.updatePaidRefCredit).toHaveBeenCalledWith(1, 10);
      expect(userService.updatePaidRefCredit).toHaveBeenCalledWith(2, 10);
      expect(userService.updatePaidRefCredit).not.toHaveBeenCalledWith(0, expect.anything());
    });

    it('updates paid ref credit with the summed volume for each id', async () => {
      const qb = mockRawQueryBuilder({ volume: 42 });
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);
      jest.spyOn(userService, 'updatePaidRefCredit').mockResolvedValue(undefined as any);

      await service.updatePaidRefCredit([7]);

      expect(userService.updatePaidRefCredit).toHaveBeenCalledWith(7, 42);
    });

    it('falls back to zero when there is no volume for an id', async () => {
      const qb = mockRawQueryBuilder({ volume: null });
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);
      jest.spyOn(userService, 'updatePaidRefCredit').mockResolvedValue(undefined as any);

      await service.updatePaidRefCredit([7]);

      expect(userService.updatePaidRefCredit).toHaveBeenCalledWith(7, 0);
    });
  });

  describe('getTransactions', () => {
    it('uses default dateFrom/dateTo when none are given', async () => {
      jest.spyOn(rewardRepo, 'findBy').mockResolvedValue([]);

      const result = await service.getTransactions();

      expect(rewardRepo.findBy).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('maps ref rewards to TransactionDetailsDto for an explicit date range', async () => {
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');
      const dateTo = new Date('2026-06-01T00:00:00.000Z');
      const outputDate = new Date('2026-03-01T00:00:00.000Z');
      jest.spyOn(rewardRepo, 'findBy').mockResolvedValue([
        {
          id: 1,
          amountInEur: 25,
          outputDate,
          outputAmount: 0.5,
          outputAsset: { dexName: 'BTC' },
        } as any,
      ]);

      const result = await service.getTransactions(dateFrom, dateTo);

      expect(result).toEqual([
        {
          id: 1,
          fiatAmount: 25,
          fiatCurrency: 'EUR',
          date: outputDate,
          cryptoAmount: 0.5,
          cryptoCurrency: 'BTC',
        },
      ]);
    });
  });

  describe('getRewardRecipients', () => {
    function mockRecipientsQueryBuilder(rows: any[]) {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      jest.spyOn(rewardRepo, 'createQueryBuilder').mockReturnValue(qb);
      return qb;
    }

    it('returns recipients without a from-filter', async () => {
      const qb = mockRecipientsQueryBuilder([{ userDataId: 10, count: '2', amountCount: '2', totalChf: '300' }]);

      const result = await service.getRewardRecipients();

      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual([{ userDataId: 10, count: 2, totalChf: 300 }]);
    });

    it('applies the from-filter when a date is given', async () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const qb = mockRecipientsQueryBuilder([{ userDataId: 10, count: '1', amountCount: '1', totalChf: '100' }]);

      await service.getRewardRecipients(from);

      expect(qb.andWhere).toHaveBeenCalledWith('r.created >= :from', { from });
    });

    it("throws when a group's count and amountCount diverge, naming the affected userDataId", async () => {
      mockRecipientsQueryBuilder([{ userDataId: 42, count: '2', amountCount: '1', totalChf: '50' }]);

      await expect(service.getRewardRecipients()).rejects.toThrow(/userDataId 42\b/);
    });

    it('converts driver string values to numbers and returns them', async () => {
      mockRecipientsQueryBuilder([
        { userDataId: 10, count: '2', amountCount: '2', totalChf: '300' },
        { userDataId: 20, count: '1', amountCount: '1', totalChf: '150' },
      ]);

      const result = await service.getRewardRecipients();

      expect(result).toStrictEqual([
        { userDataId: 10, count: 2, totalChf: 300 },
        { userDataId: 20, count: 1, totalChf: 150 },
      ]);
      expect(typeof result[0].count).toBe('number');
      expect(typeof result[0].totalChf).toBe('number');
    });
  });
});
