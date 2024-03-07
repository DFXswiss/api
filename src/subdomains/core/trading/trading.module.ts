import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { LogModule } from 'src/subdomains/supporting/log/log.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { TradingOrderController } from './controllers/trading-order.controller';
import { TradingRuleController } from './controllers/trading-rule.controller';
import { TradingOrder } from './entities/trading-order.entity';
import { TradingRule } from './entities/trading-rule.entity';
import { TradingOrderRepository } from './repositories/trading-order.respoitory';
import { TradingRuleRepository } from './repositories/trading-rule.respoitory';
import { TradingEthereumService } from './services/trading-ethereum.service';
import { TradingJobService } from './services/trading-job.service';
import { TradingOrderService } from './services/trading-order.service';
import { TradingPolygonService } from './services/trading-polygon.service';
import { TradingRegistryService } from './services/trading-registry.service';
import { TradingRuleService } from './services/trading-rule.service';

@Module({
  imports: [TypeOrmModule.forFeature([TradingRule, TradingOrder]), PricingModule, DexModule, LogModule],
  controllers: [TradingRuleController, TradingOrderController],
  providers: [
    TradingRuleRepository,
    TradingOrderRepository,
    TradingJobService,
    TradingRuleService,
    TradingOrderService,
    TradingRegistryService,
    TradingEthereumService,
    TradingPolygonService,
  ],
  exports: [],
})
export class TradingModule {}
