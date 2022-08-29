import { KrakenService } from './services/kraken.service';
import { BinanceService } from './services/binance.service';
import { BitstampService } from './services/bitstamp.service';
import { BitpandaService } from './services/bitpanda.service';
import { ExchangeController } from './exchange.controller';
import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { FixerService } from './services/fixer.service';

@Module({
  imports: [SharedModule],
  controllers: [ExchangeController],
  providers: [KrakenService, BinanceService, BitstampService, BitpandaService, FixerService],
  exports: [KrakenService, BinanceService, BitstampService, BitpandaService, FixerService],
})
export class ExchangeModule {}
