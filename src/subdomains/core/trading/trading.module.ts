import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { LiquidityManagementModule } from '../liquidity-management/liquidity-management.module';
import { TradingRuleController } from './controllers/trading-rule.controller';
import { TradingOrder } from './entities/trading-order.entity';
import { TradingRule } from './entities/trading-rule.entity';
import { TradingOrderRepository } from './repositories/trading-order.respository';
import { TradingRuleRepository } from './repositories/trading-rule.respository';
import { TradingJobService } from './services/trading-job.service';
import { TradingOrderService } from './services/trading-order.service';
import { TradingRuleService } from './services/trading-rule.service';
import { TradingService } from './services/trading.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradingRule, TradingOrder]),
    SharedModule,
    BlockchainModule,
    PricingModule,
    DexModule,
    NotificationModule,
    LiquidityManagementModule,
  ],
  controllers: [TradingRuleController],
  providers: [
    TradingRuleRepository,
    TradingOrderRepository,
    TradingService,
    TradingJobService,
    TradingRuleService,
    TradingOrderService,
  ],
  exports: [TradingRuleService, TradingOrderService],
})
export class TradingModule {}
