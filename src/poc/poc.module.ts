import { Module } from '@nestjs/common';
import { BankModule } from './subdomains/bank/bank.module';
import { BuyModule } from './subdomains/buy/buy.module';
import { ExchangeModule } from './subdomains/exchange/exchange.module';
import { NotificationModule } from './subdomains/notification/notification.module';
import { PayoutModule } from './subdomains/payout/payout.module';

@Module({
  imports: [BankModule, BuyModule, ExchangeModule, PayoutModule, NotificationModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class PocModule {}
