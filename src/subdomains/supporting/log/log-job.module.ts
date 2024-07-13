import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { TradingModule } from 'src/subdomains/core/trading/trading.module';
import { LogJobService } from './log-job.service';
import { Log } from './log.entity';
import { LogModule } from './log.module';

@Module({
  imports: [TypeOrmModule.forFeature([Log]), SharedModule, TradingModule, LiquidityManagementModule, LogModule],
  controllers: [],
  providers: [LogJobService],
  exports: [],
})
export class LogJobModule {}
