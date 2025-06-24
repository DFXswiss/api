import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { PayInWebhookModule } from 'src/subdomains/supporting/payin/payin-webhook.module';
import { BinancePayService } from './binance/services/binance-pay.service';
import { C2BController } from './controllers/c2b.controller';
import { C2BPaymentLinkService } from './services/c2b-payment-link.service';

@Module({
  imports: [SharedModule, PayInWebhookModule],
  controllers: [C2BController],
  providers: [C2BPaymentLinkService, BinancePayService],
  exports: [C2BPaymentLinkService, BinancePayService],
})
export class C2BPaymentLinkModule {}
