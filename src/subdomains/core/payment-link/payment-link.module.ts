import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { PaymentLinkController } from './controllers/payment-link.controller';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentActivationModule } from './payment-activation.module';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { PaymentCronService } from './services/payment-cron.services';
import { PaymentLinkService } from './services/payment-link.services';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLink]),
    UserModule,
    SharedModule,
    SellCryptoModule,
    PaymentLinkPaymentModule,
    PaymentActivationModule,
  ],
  controllers: [PaymentLinkController],
  providers: [PaymentLinkRepository, PaymentLinkService, PaymentCronService],
  exports: [PaymentLinkService],
})
export class PaymentLinkModule {}
