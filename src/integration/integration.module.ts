import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BankModule } from './bank/bank.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { ExchangeModule } from './exchange/exchange.module';
import { GeoLocationModule } from './geolocation/geo-location.module';
import { AzureService } from './infrastructure/azure-service';
import { LetterModule } from './letter/letter.module';

@Module({
  imports: [SharedModule, BankModule, BlockchainModule, ExchangeModule, GeoLocationModule, LetterModule],
  controllers: [],
  providers: [AzureService],
  exports: [],
})
export class IntegrationModule {}
