import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { TradingOrder } from './entities/trading-order.entity';
import { TradingRule } from './entities/trading-rule.entity';
import { TradingOrderRepository } from './repositories/trading-order.respoitory';
import { TradingRuleRepository } from './repositories/trading-rule.respoitory';
import { TradingJobService } from './services/trading-job.service';
import { TradingOrderService } from './services/trading-order.service';
import { TradingRuleService } from './services/trading-rule.service';
import { TradingService } from './services/trading.service';

@Module({
  imports: [TypeOrmModule.forFeature([TradingRule, TradingOrder]), BlockchainModule, PricingModule, DexModule],
  controllers: [],
  providers: [
    TradingRuleRepository,
    TradingOrderRepository,
    TradingService,
    TradingJobService,
    TradingRuleService,
    TradingOrderService,
  ],
  exports: [],
})
export class TradingModule {}
