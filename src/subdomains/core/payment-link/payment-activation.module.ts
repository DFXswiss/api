import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PaymentWebhookController } from './controllers/payment-webhook.controller';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentActivationService } from './services/payment-activation.service';
import { PaymentWebHookService } from './services/payment-webhhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentActivation]), SharedModule, BlockchainModule, PaymentLinkPaymentModule],
  controllers: [PaymentWebhookController],
  providers: [PaymentActivationRepository, PaymentActivationService, PaymentWebHookService],
  exports: [PaymentActivationService],
})
export class PaymentActivationModule {}
