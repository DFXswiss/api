import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { DexModule } from './dex/dex.module';
import { NotificationModule } from './notification/notification.module';
import { PayoutModule } from './payout/payout.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [BankModule, DexModule, NotificationModule, PayoutModule, PricingModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class SupportingModule {}
