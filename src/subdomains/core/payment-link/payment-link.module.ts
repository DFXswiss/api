import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkController } from './payment-link.controller';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './services/payment-link-payment.services';
import { PaymentLinkService } from './services/payment-link.services';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLink, PaymentLinkPayment]), SellCryptoModule, SharedModule, PricingModule],
  controllers: [PaymentLinkController],
  providers: [PaymentLinkService, PaymentLinkPaymentService, PaymentLinkRepository, PaymentLinkPaymentRepository],
  exports: [],
})
export class PaymentLinkModule {}
