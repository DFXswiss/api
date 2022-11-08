import { Module } from '@nestjs/common';
import { BuyCryptoModule } from './buy-crypto/buy-crypto.module';
import { HistoryModule } from './history/history.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ReferralModule } from './referral/referral.module';
import { SellCryptoModule } from './sell-crypto/sell-crypto.module';
import { StatisticModule } from './statistic/statistic.module';

@Module({
  imports: [BuyCryptoModule, HistoryModule, MonitoringModule, ReferralModule, SellCryptoModule, StatisticModule],
  controllers: [],
  providers: [],
  exports: [ReferralModule],
})
export class CoreModule {}
