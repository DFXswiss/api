import { Module } from '@nestjs/common';
import { AddressPoolModule } from './address-pool/address-pool.module';
import { BankModule } from './bank/bank.module';
import { DexModule } from './dex/dex.module';
import { FiatPayInModule } from './fiat-payin/fiat-payin.module';
import { LogModule } from './log/log.module';
import { NotificationModule } from './notification/notification.module';
import { PayInModule } from './payin/payin.module';
import { PayoutModule } from './payout/payout.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [
    AddressPoolModule,
    BankModule,
    DexModule,
    LogModule,
    NotificationModule,
    PayInModule,
    PayoutModule,
    PricingModule,
    FiatPayInModule,
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class SupportingModule {}
