import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentQuote } from './entities/payment-quote.entity';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentQuoteRepository } from './repositories/payment-quote.repository';
import { PaymentActivationService } from './services/payment-activation.service';
import { PaymentLinkPaymentService } from './services/payment-link-payment.service';
import { PaymentQuoteService } from './services/payment-quote.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLinkPayment, PaymentQuote, PaymentActivation]),
    SharedModule,
    BlockchainModule,
    LightningModule,
    PricingModule,
  ],
  controllers: [],
  providers: [
    PaymentLinkPaymentRepository,
    PaymentQuoteRepository,
    PaymentActivationRepository,
    PaymentLinkPaymentService,
    PaymentQuoteService,
    PaymentActivationService,
  ],
  exports: [PaymentLinkPaymentService, PaymentQuoteService, PaymentActivationService],
})
export class PaymentLinkPaymentModule {}
