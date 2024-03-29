import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BankModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ExchangeModule } from './exchange/exchange.module';
import { IknaModule } from './ikna/ikna.module';
import { AzureService } from './infrastructure/azure-service';
import { LetterModule } from './letter/letter.module';

@Module({
  imports: [SharedModule, BankModule, BlockchainModule, ExchangeModule, LetterModule, IknaModule, CheckoutModule],
  controllers: [],
  providers: [AzureService],
  exports: [BankModule, BlockchainModule, ExchangeModule, LetterModule, IknaModule, CheckoutModule, AzureService],
})
export class IntegrationModule {}
