import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LogModule } from '../log/log.module';
import { DashboardFinancialController } from './dashboard-financial.controller';
import { DashboardFinancialService } from './dashboard-financial.service';

@Module({
  imports: [SharedModule, LogModule],
  controllers: [DashboardFinancialController],
  providers: [DashboardFinancialService],
})
export class DashboardModule {}
