import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { ExchangeModule } from './exchange/exchange.module';
import { GeoLocationModule } from './geolocation/geo-location.module';
import { LetterModule } from './letter/letter.module';

@Module({
  imports: [BankModule, BlockchainModule, ExchangeModule, GeoLocationModule, LetterModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class IntegrationModule {}
