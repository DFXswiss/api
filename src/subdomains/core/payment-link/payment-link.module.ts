import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ForwardingModule } from 'src/subdomains/generic/forwarding/forwarding.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { PaymentLinkController, PaymentLinkShortController } from './controllers/payment-link.controller';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentLinkRepository } from './repositories/payment-link.repository';
import { PaymentCronService } from './services/payment-cron.service';
import { PaymentLinkService } from './services/payment-link.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentLink]),
    UserModule,
    SharedModule,
    SellCryptoModule,
    PaymentLinkPaymentModule,
    ForwardingModule,
  ],
  controllers: [PaymentLinkController, PaymentLinkShortController],
  providers: [PaymentLinkRepository, PaymentLinkService, PaymentCronService, PaymentLinkController],
  exports: [PaymentLinkService],
})
export class PaymentLinkModule {}
