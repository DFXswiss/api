import { createMock } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import {
  createCustomLiquidityBalance,
  createDefaultLiquidityBalance,
} from '../__mocks__/liquidity-balance.entity.mock';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';
import { LiquidityManagementService } from './liquidity-management.service';

describe('LiquidityManagementService', () => {
  let service: LiquidityManagementService;
  let ruleRepo: LiquidityManagementRuleRepository;
  let pipelineRepo: LiquidityManagementPipelineRepository;
  let balanceService: LiquidityManagementBalanceService;
  let settingService: SettingService;
  let pricingService: PricingService;
  let assetRepo: AssetRepository;
  let assetService: AssetService;
  let buyCryptoService: BuyCryptoService;
  let payoutService: PayoutService;
  let executeRuleSpy: jest.SpyInstance;

  beforeAll(() => {
    new ConfigService(); // sets module-level Config (verifyRule reads Config.liquidityManagement)
  });

  beforeEach(() => {
    ruleRepo = createMock<LiquidityManagementRuleRepository>();
    pipelineRepo = createMock<LiquidityManagementPipelineRepository>();
    balanceService = createMock<LiquidityManagementBalanceService>();
    settingService = createMock<SettingService>();
    pricingService = createMock<PricingService>();
    assetRepo = createMock<AssetRepository>();
    // the real AssetService, so the coin grouping under test is the one production runs
    assetService = new AssetService(assetRepo);
    buyCryptoService = createMock<BuyCryptoService>();
    payoutService = createMock<PayoutService>();

    service = new LiquidityManagementService(
      ruleRepo,
      pipelineRepo,
      balanceService,
      settingService,
      pricingService,
      assetService,
      buyCryptoService,
      payoutService,
    );
  });

  function createRule(partial: Partial<LiquidityManagementRule>): LiquidityManagementRule {
    return Object.assign(new LiquidityManagementRule(), {
      delayActivation: true,
      optimal: 0,
      ...partial,
    });
  }

  describe('verifyRule ruleActivations debounce invariant', () => {
    beforeEach(() => {
      executeRuleSpy = jest.spyOn(service as any, 'executeRule').mockResolvedValue(undefined as any);
    });

    it('keeps the activation timer across a drain chunk', async () => {
      const rule = createRule({
        id: 1,
        status: LiquidityManagementRuleStatus.ACTIVE,
        delayActivation: true,
      });
      const balance = createDefaultLiquidityBalance();

      jest.spyOn(balanceService, 'findRelevantBalance').mockReturnValue(balance);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Price.create('EUR', 'ASSET', 1));
      jest.spyOn(rule, 'verify').mockReturnValue({
        action: LiquidityOptimizationType.REDUNDANCY,
        minAmount: 0,
        maxAmount: 100,
      });
      jest.spyOn(balanceService, 'hasPendingOrders').mockResolvedValue(false);
      jest.spyOn(settingService, 'get').mockResolvedValue('15');

      service['ruleActivations'].set(rule.id, Util.minutesBefore(60));

      await service['verifyRule'](rule, [balance]);

      expect(executeRuleSpy).toHaveBeenCalledTimes(1);
      expect(service['ruleActivations'].has(rule.id)).toBe(true);
    });

    it('keeps the activation timer while a rule is processing between chunks', async () => {
      const rule = createRule({
        id: 3,
        status: LiquidityManagementRuleStatus.PROCESSING,
      });

      service['ruleActivations'].set(rule.id, new Date());

      await service['verifyRule'](rule, []);

      expect(service['ruleActivations'].has(rule.id)).toBe(true);
      expect(executeRuleSpy).not.toHaveBeenCalled();
    });
  });

  describe('resetActivation', () => {
    it('clears the activation timer for the given rule id', () => {
      const ruleId = 7;

      service['ruleActivations'].set(ruleId, new Date());

      service.resetActivation(ruleId);

      expect(service['ruleActivations'].has(ruleId)).toBe(false);
    });
  });

  /**
   * A coin with payouts still waiting must not be sold, wherever that coin sits.
   *
   * The setup is the one that produced the incident: the payout wallet holds the coin a customer is
   * waiting for, the same coin was bought at a trading venue to cover the shortfall, the delivery to
   * the payout wallet failed, and the purchase is now sitting at the venue above that rule's
   * `maximal` — indistinguishable, to the rule alone, from surplus.
   */
  describe('withholding a sale while payouts of the coin are waiting', () => {
    const PAYOUT_WALLET_COIN_ID = 241;
    const VENUE_COIN_ID = 396;
    const TESTNET_LOOKALIKE_ID = 417;

    let payoutWalletCoin: Asset;
    let venueCoin: Asset;
    let testnetLookalike: Asset;

    beforeEach(() => {
      payoutWalletCoin = createCustomAsset({
        id: PAYOUT_WALLET_COIN_ID,
        name: 'COIN',
        uniqueName: 'Chain/COIN',
        dexName: 'COIN',
        type: AssetType.COIN,
        blockchain: Blockchain.MONERO,
      });
      venueCoin = createCustomAsset({
        id: VENUE_COIN_ID,
        name: 'COIN',
        uniqueName: 'Venue/COIN',
        dexName: 'COIN',
        type: AssetType.CUSTODY,
        blockchain: Blockchain.MEXC,
      });
      // same ticker, different network: worthless against the coin above
      testnetLookalike = createCustomAsset({
        id: TESTNET_LOOKALIKE_ID,
        name: 'COIN',
        uniqueName: 'Testnet/COIN',
        dexName: 'COIN',
        type: AssetType.COIN,
        blockchain: Blockchain.BITCOIN_TESTNET4,
      });

      jest.spyOn(assetRepo, 'findCachedBy').mockResolvedValue([payoutWalletCoin, venueCoin, testnetLookalike]);
      jest.spyOn(balanceService, 'hasPendingOrders').mockResolvedValue(false);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Price.create('EUR', 'COIN', 1));
      jest.spyOn(settingService, 'get').mockResolvedValue('30');
      jest.spyOn(buyCryptoService, 'countAwaitingPayout').mockResolvedValue(0);
      jest.spyOn(payoutService, 'countPendingPayouts').mockResolvedValue(0);
      jest.spyOn(pipelineRepo, 'findOneBy').mockResolvedValue(undefined); // no pipeline running yet
      jest.spyOn(pipelineRepo, 'save').mockImplementation(async (pipeline) => pipeline as never);
    });

    /** The venue rule of the incident: sells anything above `maximal`, buys back below `minimal`. */
    function venueRule(): LiquidityManagementRule {
      return createRule({
        id: 309,
        status: LiquidityManagementRuleStatus.ACTIVE,
        targetAsset: venueCoin,
        minimal: 0,
        optimal: 0.1,
        maximal: 1,
        delayActivation: false,
        deficitStartAction: Object.assign(new LiquidityManagementAction(), { id: 1 }),
        redundancyStartAction: Object.assign(new LiquidityManagementAction(), { id: 2 }),
      });
    }

    /** The purchase made for a waiting customer, still at the venue because its delivery failed. */
    function undeliveredPurchase(rule: LiquidityManagementRule) {
      const balance = createCustomLiquidityBalance({ asset: rule.targetAsset, amount: 112 });
      jest.spyOn(balanceService, 'findRelevantBalance').mockReturnValue(balance);

      return balance;
    }

    it('starts no sale while a transaction is waiting for a payout of that coin', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);
      jest.spyOn(buyCryptoService, 'countAwaitingPayout').mockResolvedValue(1);

      await service['verifyRule'](rule, [balance]);

      expect(pipelineRepo.save).not.toHaveBeenCalled();
      expect(rule.status).toBe(LiquidityManagementRuleStatus.ACTIVE);
    });

    it('starts no sale while a payout order of that coin has not reached its recipient', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);
      jest.spyOn(payoutService, 'countPendingPayouts').mockResolvedValue(2);

      await service['verifyRule'](rule, [balance]);

      expect(pipelineRepo.save).not.toHaveBeenCalled();
    });

    it('names the coin and the demand that withheld the sale', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);
      jest.spyOn(buyCryptoService, 'countAwaitingPayout').mockResolvedValue(1);
      jest.spyOn(payoutService, 'countPendingPayouts').mockResolvedValue(2);
      const infoSpy = jest.spyOn(service['logger'], 'info');

      await service['verifyRule'](rule, [balance]);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 transaction(s) and 2 payout order(s) are waiting for COIN'),
      );
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Chain/COIN'));
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Venue/COIN'));
    });

    it('looks for the demand across every place the coin is held, and nowhere else', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);

      await service['verifyRule'](rule, [balance]);

      expect(buyCryptoService.countAwaitingPayout).toHaveBeenCalledWith([PAYOUT_WALLET_COIN_ID, VENUE_COIN_ID]);
      expect(payoutService.countPendingPayouts).toHaveBeenCalledWith([PAYOUT_WALLET_COIN_ID, VENUE_COIN_ID]);
    });

    it('sells a genuine surplus when nothing is waiting for the coin', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);

      await service['verifyRule'](rule, [balance]);

      expect(pipelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: LiquidityOptimizationType.REDUNDANCY, rule }),
      );
      expect(rule.status).toBe(LiquidityManagementRuleStatus.PROCESSING);
    });

    it('sells when the only demand is for a different coin that merely shares the ticker', async () => {
      const rule = venueRule();
      const balance = undeliveredPurchase(rule);
      jest
        .spyOn(buyCryptoService, 'countAwaitingPayout')
        .mockImplementation(async (assetIds) => (assetIds.includes(TESTNET_LOOKALIKE_ID) ? 1 : 0));

      await service['verifyRule'](rule, [balance]);

      expect(pipelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: LiquidityOptimizationType.REDUNDANCY }),
      );
    });

    it('leaves the deficit path alone — it is what serves the waiting demand', async () => {
      const rule = venueRule();
      rule.minimal = 10;
      const balance = createCustomLiquidityBalance({ asset: venueCoin, amount: 0 });
      jest.spyOn(balanceService, 'findRelevantBalance').mockReturnValue(balance);
      jest.spyOn(buyCryptoService, 'countAwaitingPayout').mockResolvedValue(1);

      await service['verifyRule'](rule, [balance]);

      expect(pipelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: LiquidityOptimizationType.DEFICIT }),
      );
      expect(buyCryptoService.countAwaitingPayout).not.toHaveBeenCalled();
    });

    it('withholds a manually requested sale too, and says why', async () => {
      const rule = venueRule();
      jest.spyOn(ruleRepo, 'findOneBy').mockResolvedValue(rule);
      jest.spyOn(buyCryptoService, 'countAwaitingPayout').mockResolvedValue(1);

      await expect(service.sellLiquidity(VENUE_COIN_ID, 1, 100, false)).rejects.toThrow(
        new ConflictException('Pipeline for rule 309 cannot be started: payouts of COIN are waiting'),
      );
      expect(pipelineRepo.save).not.toHaveBeenCalled();
    });

    it('asks for no demand at all for a rule holding fiat', async () => {
      const rule = createRule({
        id: 213,
        status: LiquidityManagementRuleStatus.ACTIVE,
        targetAsset: undefined,
        targetFiat: createCustomFiat({ id: 2, name: 'EUR' }),
        minimal: 0,
        optimal: 0,
        maximal: 1,
        delayActivation: false,
        redundancyStartAction: Object.assign(new LiquidityManagementAction(), { id: 2 }),
      });
      const balance = createCustomLiquidityBalance({ asset: undefined, amount: 100 });
      jest.spyOn(balanceService, 'findRelevantBalance').mockReturnValue(balance);

      await service['verifyRule'](rule, [balance]);

      expect(buyCryptoService.countAwaitingPayout).not.toHaveBeenCalled();
      expect(payoutService.countPendingPayouts).not.toHaveBeenCalled();
      expect(pipelineRepo.save).toHaveBeenCalled();
    });
  });
});
