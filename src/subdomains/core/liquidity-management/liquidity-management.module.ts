import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementRuleController } from './controllers/rule.controller';
import { LiquidityActionIntegrationFactory } from './factories/liquidity-action-integration.factory';
import { LiquidityBalanceIntegrationFactory } from './factories/liquidity-balance-integration.factory';
import { LiquidityBalanceRepository } from './repositories/liquidity-balance.repository';
import { LiquidityManagementActionRepository } from './repositories/liquidity-management-action.repository';
import { LiquidityManagementOrderRepository } from './repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from './repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from './repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from './services/liquidity-management-pipeline.service';
import { LiquidityManagementRuleService } from './services/liquidity-management-rule.service';
import { LiquidityManagementService } from './services/liquidity-management.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiquidityManagementRuleRepository,
      LiquidityManagementActionRepository,
      LiquidityManagementPipelineRepository,
      LiquidityManagementOrderRepository,
      LiquidityBalanceRepository,
    ]),
    SharedModule,
  ],
  controllers: [LiquidityManagementRuleController],
  providers: [
    LiquidityManagementService,
    LiquidityManagementRuleService,
    LiquidityManagementPipelineService,
    LiquidityManagementBalanceService,
    LiquidityActionIntegrationFactory,
    LiquidityBalanceIntegrationFactory,
  ],
  exports: [],
})
export class LiquidityManagementModule {}
