import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPaymentQuote } from './entities/payment-link-payment-quote.entity';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentLinkPaymentQuoteRepository } from './repositories/payment-link-payment-quote.repository';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentActivationService } from './services/payment-activation.service';
import { PaymentLinkPaymentQuoteService } from './services/payment-link-payment-quote.service';
import { PaymentLinkPaymentService } from './services/payment-link-payment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLinkPayment, PaymentLinkPaymentQuote, PaymentActivation]),
    SharedModule,
    LightningModule,
    PricingModule,
    PayoutModule,
  ],
  controllers: [],
  providers: [
    PaymentLinkPaymentRepository,
    PaymentLinkPaymentQuoteRepository,
    PaymentActivationRepository,
    PaymentLinkPaymentService,
    PaymentLinkPaymentQuoteService,
    PaymentActivationService,
  ],
  exports: [PaymentLinkPaymentService, PaymentLinkPaymentQuoteService, PaymentActivationService],
})
export class PaymentLinkPaymentModule {}
