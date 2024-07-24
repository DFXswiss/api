import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentLinkPaymentService } from './services/payment-link-payment.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLinkPayment]), SharedModule, PricingModule],
  controllers: [],
  providers: [PaymentLinkPaymentRepository, PaymentLinkPaymentService],
  exports: [PaymentLinkPaymentService],
})
export class PaymentLinkPaymentModule {}
