import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BinancePayService } from './services/binance-pay.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [BinancePayService],
  exports: [BinancePayService],
})
export class BinancePayModule {}
