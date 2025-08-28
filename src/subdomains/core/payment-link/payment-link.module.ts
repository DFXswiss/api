import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinancePayModule } from 'src/integration/binance-pay/binance-pay.module';
import { KucoinPayModule } from 'src/integration/kucoin-pay/kucoin-pay.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PayInWebhookModule } from 'src/subdomains/supporting/payin/payin-webhook.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { C2BPaymentLinkController } from './controllers/c2b-payment-link.controller';
import { PaymentLinkController, PaymentLinkShortController } from './controllers/payment-link.controller';
import { PaymentLinkGateway } from './controllers/payment-link.gateway';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentMerchant } from './entities/payment-merchant.entity';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { PaymentMerchantRepository } from './repositories/payment-merchant.repository';
import { BlockchainAvailabilityService } from './services/blockchain-availability.service';
import { OCPStickerService } from './services/ocp-sticker.service';
import { PaymentCronService } from './services/payment-cron.service';
import { PaymentLinkService } from './services/payment-link.service';
import { PaymentMerchantService } from './services/payment-merchant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLink, PaymentMerchant]),
    UserModule,
    SharedModule,
    PayInWebhookModule,
    SellCryptoModule,
    PaymentLinkPaymentModule,
    BinancePayModule,
    KucoinPayModule,
  ],
  controllers: [PaymentLinkController, PaymentLinkShortController, C2BPaymentLinkController],
  providers: [
    PaymentLinkRepository,
    PaymentLinkService,
    PaymentMerchantRepository,
    PaymentMerchantService,
    BlockchainAvailabilityService,
    OCPStickerService,
    PaymentCronService,
    PaymentLinkController,
    PaymentLinkGateway,
  ],
  exports: [PaymentLinkService, BlockchainAvailabilityService],
})
export class PaymentLinkModule {}
