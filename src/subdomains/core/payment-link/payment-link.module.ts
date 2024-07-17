import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkController } from './payment-link.controller';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from './repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { PaymentActivationService } from './services/payment-activation.service';
import { PaymentCronService } from './services/payment-cron.services';
import { PaymentLinkService } from './services/payment-link.services';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLink, PaymentLinkPayment, PaymentActivation]),
    SellCryptoModule,
    SharedModule,
    PricingModule,
    BlockchainModule,
  ],
  controllers: [PaymentLinkController],
  providers: [
    PaymentLinkRepository,
    PaymentLinkPaymentRepository,
    PaymentActivationRepository,
    PaymentLinkService,
    PaymentActivationService,
    PaymentCronService,
  ],
  exports: [PaymentLinkService, PaymentActivationService],
})
export class PaymentLinkModule {}
