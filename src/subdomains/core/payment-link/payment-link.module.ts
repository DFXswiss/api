import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkController } from './payment-link.controller';
import { PaymentLinkPaymentService } from './services/payment-link-payment.services';
import { PaymentLinkService } from './services/payment-link.services';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLink, PaymentLinkPayment])],
  controllers: [PaymentLinkController],
  providers: [PaymentLinkService, PaymentLinkPaymentService],
  exports: [],
})
export class PaymentLinkModule {}
