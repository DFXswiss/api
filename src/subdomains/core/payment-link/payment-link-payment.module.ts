import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { PaymentLinkPaymentQuote } from './entities/payment-link-payment-quote.entity';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLinkPaymentQuoteRepository } from './repositories/payment-link-payment-quote.repository';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentLinkPaymentQuoteService } from './services/payment-link-payment-quote.service';
import { PaymentLinkPaymentService } from './services/payment-link-payment.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLinkPayment, PaymentLinkPaymentQuote]), SharedModule, PricingModule],
  controllers: [],
  providers: [
    PaymentLinkPaymentRepository,
    PaymentLinkPaymentQuoteRepository,
    PaymentLinkPaymentService,
    PaymentLinkPaymentQuoteService,
  ],
  exports: [PaymentLinkPaymentService, PaymentLinkPaymentQuoteService],
})
export class PaymentLinkPaymentModule {}
