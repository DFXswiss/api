import { Module } from '@nestjs/common';
import { AddressPoolModule } from './address-pool/address-pool.module';
import { BalanceModule } from './balance/balance.module';
import { BankTxModule } from './bank-tx/bank-tx.module';
import { BankModule } from './bank/bank.module';
import { DexModule } from './dex/dex.module';
import { FiatOutputModule } from './fiat-output/fiat-output.module';
import { FiatPayInModule } from './fiat-payin/fiat-payin.module';
import { LogModule } from './log/log.module';
import { NotificationModule } from './notification/notification.module';
import { PayInModule } from './payin/payin.module';
import { PayoutModule } from './payout/payout.module';
import { PricingModule } from './pricing/pricing.module';
import { RecallModule } from './recall/recall.module';
import { SupportIssueModule } from './support-issue/support-issue.module';

@Module({
  imports: [
    AddressPoolModule,
    BalanceModule,
    BankModule,
    BankTxModule,
    DexModule,
    LogModule,
    NotificationModule,
    PayInModule,
    PayoutModule,
    PricingModule,
    FiatPayInModule,
    FiatOutputModule,
    SupportIssueModule,
    RecallModule,
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class SupportingModule {}
