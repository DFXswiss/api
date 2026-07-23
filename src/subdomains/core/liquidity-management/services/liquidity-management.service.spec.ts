import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createDefaultLiquidityBalance } from '../__mocks__/liquidity-balance.entity.mock';
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

    service = new LiquidityManagementService(ruleRepo, pipelineRepo, balanceService, settingService, pricingService);

    executeRuleSpy = jest.spyOn(service as any, 'executeRule').mockResolvedValue(undefined as any);
  });

  function createRule(partial: Partial<LiquidityManagementRule>): LiquidityManagementRule {
    return Object.assign(new LiquidityManagementRule(), {
      delayActivation: true,
      optimal: 0,
      ...partial,
    });
  }

  describe('verifyRule ruleActivations debounce invariant', () => {
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

    it('clears the activation timer when a rule is paused', async () => {
      const rule = createRule({
        id: 2,
        status: LiquidityManagementRuleStatus.PAUSED,
      });

      service['ruleActivations'].set(rule.id, new Date());

      await service['verifyRule'](rule, []);

      expect(service['ruleActivations'].has(rule.id)).toBe(false);
      expect(executeRuleSpy).not.toHaveBeenCalled();
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
});
