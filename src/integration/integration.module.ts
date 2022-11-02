import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { ExchangeModule } from './exchange/exchange.module';

@Module({
  imports: [BankModule, BlockchainModule, ExchangeModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class IntegrationModule {}
