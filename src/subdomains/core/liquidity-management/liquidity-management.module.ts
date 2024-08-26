import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankIntegrationModule } from 'src/integration/bank/bank.module';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { ExchangeModule } from 'src/integration/exchange/exchange.module';
import { SharedModule } from 'src/shared/shared.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { ArbitrumL2BridgeAdapter } from './adapters/actions/arbitrum-l2-bridge.adapter';
import { BaseL2BridgeAdapter } from './adapters/actions/base-l2-bridge.adapter';
import { BinanceAdapter } from './adapters/actions/binance.adapter';
import { DfxDexAdapter } from './adapters/actions/dfx-dex.adapter';
import { KrakenAdapter } from './adapters/actions/kraken.adapter';
import { LiquidityPipelineAdapter } from './adapters/actions/liquidity-pipeline.adapter';
import { OptimismL2BridgeAdapter } from './adapters/actions/optimism-l2-bridge.adapter';
import { PolygonL2BridgeAdapter } from './adapters/actions/polygon-l2-bridge.adapter';
import { BankAdapter } from './adapters/balances/bank.adapter';
import { BlockchainAdapter } from './adapters/balances/blockchain.adapter';
import { ExchangeAdapter } from './adapters/balances/exchange.adapter';
import { LiquidityBalanceController } from './controllers/balance.controller';
import { LiquidityManagementOrderController } from './controllers/order.controller';
import { LiquidityManagementPipelineController } from './controllers/pipeline.controller';
import { LiquidityManagementRuleController } from './controllers/rule.controller';
import { LiquidityBalance } from './entities/liquidity-balance.entity';
import { LiquidityManagementAction } from './entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from './entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from './entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from './entities/liquidity-management-rule.entity';
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
      LiquidityManagementRule,
      LiquidityManagementAction,
      LiquidityManagementPipeline,
      LiquidityManagementOrder,
      LiquidityBalance,
    ]),
    SharedModule,
    DexModule,
    BlockchainModule,
    ExchangeModule,
    BankIntegrationModule,
    NotificationModule,
    BankModule,
    BankTxModule,
  ],
  controllers: [
    LiquidityManagementRuleController,
    LiquidityBalanceController,
    LiquidityManagementOrderController,
    LiquidityManagementPipelineController,
  ],
  providers: [
    LiquidityManagementRuleRepository,
    LiquidityManagementActionRepository,
    LiquidityManagementPipelineRepository,
    LiquidityManagementOrderRepository,
    LiquidityBalanceRepository,
    LiquidityManagementService,
    LiquidityManagementRuleService,
    LiquidityManagementPipelineService,
    LiquidityManagementBalanceService,
    LiquidityActionIntegrationFactory,
    LiquidityBalanceIntegrationFactory,
    BlockchainAdapter,
    ExchangeAdapter,
    BankAdapter,
    DfxDexAdapter,
    ArbitrumL2BridgeAdapter,
    OptimismL2BridgeAdapter,
    PolygonL2BridgeAdapter,
    BaseL2BridgeAdapter,
    BinanceAdapter,
    KrakenAdapter,
    LiquidityPipelineAdapter,
  ],
  exports: [LiquidityManagementService, LiquidityManagementBalanceService],
})
export class LiquidityManagementModule {}
