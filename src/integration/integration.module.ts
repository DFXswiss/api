import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BankIntegrationModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ExchangeModule } from './exchange/exchange.module';
import { IknaModule } from './ikna/ikna.module';
import { AppInsightsQueryService } from './infrastructure/app-insights-query.service';
import { LetterModule } from './letter/letter.module';
import { SiftModule } from './sift/sift.module';

@Module({
  imports: [
    SharedModule,
    BankIntegrationModule,
    BlockchainModule,
    ExchangeModule,
    LetterModule,
    IknaModule,
    CheckoutModule,
    SiftModule,
  ],
  controllers: [],
  providers: [AppInsightsQueryService],
  exports: [
    BankIntegrationModule,
    BlockchainModule,
    ExchangeModule,
    LetterModule,
    IknaModule,
    CheckoutModule,
    AppInsightsQueryService,
    SiftModule,
  ],
})
export class IntegrationModule {}
