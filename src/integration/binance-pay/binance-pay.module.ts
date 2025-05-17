import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BinancePayService } from './binance-pay.service';

@Module({
  imports: [SharedModule],
  providers: [BinancePayService],
  exports: [BinancePayService],
})
export class BinancePayModule {}
