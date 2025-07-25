import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinancePayModule } from 'src/integration/binance-pay/binance-pay.module';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { KucoinPayModule } from 'src/integration/kucoin-pay/kucoin-pay.module';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentQuote } from './entities/payment-quote.entity';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentQuoteRepository } from './repositories/payment-quote.repository';
import { C2BPaymentLinkService } from './services/c2b-payment-link.service';
import { PaymentActivationService } from './services/payment-activation.service';
import { PaymentLinkFeeService } from './services/payment-link-fee.service';
import { PaymentLinkPaymentService } from './services/payment-link-payment.service';
import { PaymentQuoteService } from './services/payment-quote.service';
import { PaymentWebhookService } from './services/payment-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLinkPayment, PaymentQuote, PaymentActivation]),
    SharedModule,
    BlockchainModule,
    LightningModule,
    PricingModule,
    PayoutModule,
    BinancePayModule,
    KucoinPayModule,
  ],
  controllers: [],
  providers: [
    PaymentLinkPaymentRepository,
    PaymentQuoteRepository,
    PaymentActivationRepository,
    PaymentLinkPaymentService,
    PaymentQuoteService,
    PaymentActivationService,
    PaymentWebhookService,
    C2BPaymentLinkService,
    PaymentLinkFeeService,
  ],
  exports: [PaymentLinkPaymentService, PaymentQuoteService, PaymentActivationService, C2BPaymentLinkService],
})
export class PaymentLinkPaymentModule {}
