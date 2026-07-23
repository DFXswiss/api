import { createMock } from '@golevelup/ts-jest';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import {
  LiquidityManagementPipelineStatus,
  LiquidityManagementRuleStatus,
  LiquidityOptimizationType,
} from '../enums';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementPipelineService } from './liquidity-management-pipeline.service';
import { LiquidityManagementService } from './liquidity-management.service';

describe('LiquidityManagementPipelineService', () => {
  let service: LiquidityManagementPipelineService;
  let ruleRepo: LiquidityManagementRuleRepository;
  let orderRepo: LiquidityManagementOrderRepository;
  let pipelineRepo: LiquidityManagementPipelineRepository;
  let actionIntegrationFactory: LiquidityActionIntegrationFactory;
  let notificationService: NotificationService;
  let liquidityManagementService: LiquidityManagementService;

  beforeEach(() => {
    ruleRepo = createMock<LiquidityManagementRuleRepository>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();
    pipelineRepo = createMock<LiquidityManagementPipelineRepository>();
    actionIntegrationFactory = createMock<LiquidityActionIntegrationFactory>();
    notificationService = createMock<NotificationService>();
    liquidityManagementService = createMock<LiquidityManagementService>();

    service = new LiquidityManagementPipelineService(
      ruleRepo,
      orderRepo,
      pipelineRepo,
      actionIntegrationFactory,
      notificationService,
      liquidityManagementService,
    );
  });

  describe('handlePipelineFail', () => {
    it('resets the activation debounce timer when a rule is paused', async () => {
      const rule = Object.assign(new LiquidityManagementRule(), {
        id: 42,
        status: LiquidityManagementRuleStatus.PROCESSING,
        sendNotifications: false,
        targetFiat: { name: 'EUR' },
      });
      const pipeline = Object.assign(new LiquidityManagementPipeline(), {
        id: 1,
        type: LiquidityOptimizationType.DEFICIT,
        maxAmount: 100,
        status: LiquidityManagementPipelineStatus.FAILED,
        rule,
      });
      const order = Object.assign(new LiquidityManagementOrder(), {
        errorMessage: 'order failed',
      });

      await service['handlePipelineFail'](pipeline, order);

      expect(liquidityManagementService.resetActivation).toHaveBeenCalledWith(42);
      expect(rule.status).toBe(LiquidityManagementRuleStatus.PAUSED);
      expect(ruleRepo.save).toHaveBeenCalledWith(rule);
    });
  });
});
