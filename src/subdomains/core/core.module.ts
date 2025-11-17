import { Module } from '@nestjs/common';
import { BuyCryptoModule } from './buy-crypto/buy-crypto.module';
import { CustodyModule } from './custody/custody.module';
import { FaucetModule } from './faucet/faucet.module';
import { HistoryModule } from './history/history.module';
import { LiquidityManagementModule } from './liquidity-management/liquidity-management.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { PaymentLinkModule } from './payment-link/payment-link.module';
import { ReferralModule } from './referral/referral.module';
import { RouteModule } from './route/route.module';
import { SellCryptoModule } from './sell-crypto/sell-crypto.module';
import { StatisticModule } from './statistic/statistic.module';
import { TradingModule } from './trading/trading.module';
import { TransactionUtilModule } from './transaction/transaction-util.module';

@Module({
  imports: [
    BuyCryptoModule,
    HistoryModule,
    MonitoringModule,
    ReferralModule,
    SellCryptoModule,
    StatisticModule,
    LiquidityManagementModule,
    TradingModule,
    PaymentLinkModule,
    TransactionUtilModule,
    RouteModule,
    CustodyModule,
    FaucetModule,
  ],
  controllers: [],
  providers: [],
  exports: [ReferralModule],
})
export class CoreModule {}
