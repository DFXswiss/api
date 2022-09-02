import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [SharedModule, ExchangeModule, DexModule],
  controllers: [],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
