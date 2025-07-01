import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { ExchangeController } from './controllers/exchange.controller';
import { ExchangeTx } from './entities/exchange-tx.entity';
import { ExchangeTxRepository } from './repositories/exchange-tx.repository';
import { BinanceService } from './services/binance.service';
import { BitstampService } from './services/bitstamp.service';
import { ExchangeRegistryService } from './services/exchange-registry.service';
import { ExchangeTxService } from './services/exchange-tx.service';
import { KrakenService } from './services/kraken.service';
import { KucoinService } from './services/kucoin.service';
import { XtService } from './services/xt.service';
// import { P2BService } from './services/p2b.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExchangeTx]), SharedModule, forwardRef(() => PricingModule)],
  controllers: [ExchangeController],
  providers: [
    ExchangeTxRepository,
    ExchangeRegistryService,
    KrakenService,
    BinanceService,
    BitstampService,
    KucoinService,
    ExchangeTxService,
    XtService,
    // P2BService,
  ],
  exports: [
    ExchangeRegistryService,
    KrakenService,
    BinanceService,
    BitstampService,
    KucoinService,
    ExchangeTxService,
    XtService,
  ],
})
export class ExchangeModule {}
