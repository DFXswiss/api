import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { C2BPaymentLinkService } from './c2b-payment-link.service';
import { BinancePayService } from './services/binance-pay.service';

@Module({
  imports: [SharedModule],
  providers: [BinancePayService, C2BPaymentLinkService],
  exports: [C2BPaymentLinkService, BinancePayService],
})
export class C2BPaymentLinkModule {}
