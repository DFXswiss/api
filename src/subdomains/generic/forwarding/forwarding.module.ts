import { Module } from '@nestjs/common';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { PaymentLinkPaymentModule } from 'src/subdomains/core/payment-link/payment-link-payment.module';
import { PaymentLinkModule } from 'src/subdomains/core/payment-link/payment-link.module';
import { LnUrlPForwardController } from './controllers/lnurlp-forward.controller';
import { LnUrlWForwardController } from './controllers/lnurlw-forward.controller';
import { LnUrlForwardService } from './services/lnurl-forward.service';

@Module({
  imports: [LightningModule, PaymentLinkModule, PaymentLinkPaymentModule],
  controllers: [LnUrlPForwardController, LnUrlWForwardController],
  providers: [LnUrlForwardService],
  exports: [LnUrlForwardService],
})
export class ForwardingModule {}
