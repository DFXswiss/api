import { Module } from '@nestjs/common';
import { BankModule } from './subdomains/bank/bank.module';
import { BuyModule } from './subdomains/buy/buy.module';
import { ExchangeModule } from './subdomains/exchange/exchange.module';

@Module({
  imports: [BankModule, BuyModule, ExchangeModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class PocModule {}
