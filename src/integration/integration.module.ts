import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BankIntegrationModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ExchangeModule } from './exchange/exchange.module';
import { IknaModule } from './ikna/ikna.module';
import { AzureService } from './infrastructure/azure-service';
import { LetterModule } from './letter/letter.module';
import { RealUnitModule } from './realunit/realunit.module';
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
    RealUnitModule,
  ],
  controllers: [],
  providers: [AzureService],
  exports: [
    BankIntegrationModule,
    BlockchainModule,
    ExchangeModule,
    LetterModule,
    IknaModule,
    CheckoutModule,
    AzureService,
    SiftModule,
    RealUnitModule,
  ],
})
export class IntegrationModule {}
