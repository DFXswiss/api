import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ExchangeController } from './controllers/exchange.controller';
import { ExchangeTx } from './entities/exchange-tx.entity';
import { ExchangeTxRepository } from './repositories/exchange-tx.repository';
import { BinanceService } from './services/binance.service';
import { BitpandaService } from './services/bitpanda.service';
import { BitstampService } from './services/bitstamp.service';
import { ExchangeRegistryService } from './services/exchange-registry.service';
import { ExchangeTxService } from './services/exchange-tx.service';
import { KrakenService } from './services/kraken.service';
import { KucoinService } from './services/kucoin.service';
// import { P2BService } from './services/p2b.service';

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
    ExchangeTxService,
    // P2BService,
  ],
  exports: [
    ExchangeRegistryService,
    KrakenService,
    BinanceService,
    BitstampService,
    BitpandaService,
    KucoinService,
    ExchangeTxService,
  ],
})
export class ExchangeModule {}
