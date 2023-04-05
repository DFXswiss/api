import { KrakenService } from './services/kraken.service';
import { BinanceService } from './services/binance.service';
import { BitstampService } from './services/bitstamp.service';
import { BitpandaService } from './services/bitpanda.service';
import { ExchangeController } from './controllers/exchange.controller';
import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CurrencyService } from './services/currency.service';
import { FixerService } from './services/fixer.service';
import { KucoinService } from './services/kucoin.service';
import { ConversionService } from './services/conversion.service';
import { ExchangeRegistryService } from './services/exchange-registry.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeTxRepository } from './repositories/exchange-tx.repository';
import { ExchangeTxService } from './services/exchange-tx.service';
import { ExchangeTx } from './entities/exchange-tx.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExchangeTx]), SharedModule],
  controllers: [ExchangeController],
  providers: [
    ExchangeTxRepository,
    ExchangeRegistryService,
    KrakenService,
    BinanceService,
    BitstampService,
    BitpandaService,
    KucoinService,
    FixerService,
    CurrencyService,
    ConversionService,
    ExchangeTxService,
  ],
  exports: [
    ExchangeRegistryService,
    KrakenService,
    BinanceService,
    BitstampService,
    BitpandaService,
    KucoinService,
    FixerService,
    CurrencyService,
    ConversionService,
  ],
})
export class ExchangeModule {}
