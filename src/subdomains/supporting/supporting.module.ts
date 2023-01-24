import { Module } from '@nestjs/common';
import { AddressPoolModule } from './address-pool/address-pool.module';
import { BankModule } from './bank/bank.module';
import { DexModule } from './dex/dex.module';
import { LogModule } from './log/log.module';
import { MasternodeModule } from './masternode/masternode.module';
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
    MasternodeModule,
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class SupportingModule {}
