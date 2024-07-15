import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { TradingModule } from 'src/subdomains/core/trading/trading.module';
import { LogJobService } from './log-job.service';
import { LogModule } from './log.module';

@Module({
  imports: [SharedModule, TradingModule, LiquidityManagementModule, LogModule],
  controllers: [],
  providers: [LogJobService],
  exports: [],
})
export class LogJobModule {}
