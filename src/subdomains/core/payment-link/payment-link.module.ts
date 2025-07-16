import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinancePayModule } from 'src/integration/binance-pay/binance-pay.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PayInWebhookModule } from 'src/subdomains/supporting/payin/payin-webhook.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { C2BPaymentLinkController } from './controllers/c2b-payment-link.controller';
import { PaymentLinkController, PaymentLinkShortController } from './controllers/payment-link.controller';
import { PaymentLinkGateway } from './controllers/payment-link.gateway';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { OCPStickerService } from './services/ocp-sticker.service';
import { PaymentCronService } from './services/payment-cron.service';
import { PaymentLinkService } from './services/payment-link.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLink]),
    UserModule,
    SharedModule,
    PayInWebhookModule,
    SellCryptoModule,
    PaymentLinkPaymentModule,
    BinancePayModule,
  ],
  controllers: [PaymentLinkController, PaymentLinkShortController, C2BPaymentLinkController],
  providers: [
    PaymentLinkRepository,
    PaymentLinkService,
    OCPStickerService,
    PaymentCronService,
    PaymentLinkController,
    PaymentLinkGateway,
  ],
  exports: [PaymentLinkService],
})
export class PaymentLinkModule {}
