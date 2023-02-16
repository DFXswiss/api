import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule } from 'src/integration/bank/bank.module';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { DfxDexAdapter } from './adapters/actions/dfx-dex.adapter';
import { EvmL2BridgeAdapter } from './adapters/actions/evm-l2-bridge.adapter';
import { BankAdapter } from './adapters/balances/bank.adapter';
import { BlockchainAdapter } from './adapters/balances/blockchain.adapter';
import { LiquidityBalanceController } from './controllers/balance.controller';
import { LiquidityManagementOrderController } from './controllers/order.controller';
import { LiquidityManagementPipelineController } from './controllers/pipeline.controller';
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
    DexModule,
    BlockchainModule,
    BankModule,
    NotificationModule,
  ],
  controllers: [
    LiquidityManagementRuleController,
    LiquidityBalanceController,
    LiquidityManagementOrderController,
    LiquidityManagementPipelineController,
  ],
  providers: [
    LiquidityManagementService,
    LiquidityManagementRuleService,
    LiquidityManagementPipelineService,
    LiquidityManagementBalanceService,
    LiquidityActionIntegrationFactory,
    LiquidityBalanceIntegrationFactory,
    BlockchainAdapter,
    BankAdapter,
    DfxDexAdapter,
    EvmL2BridgeAdapter,
  ],
  exports: [],
})
export class LiquidityManagementModule {}
