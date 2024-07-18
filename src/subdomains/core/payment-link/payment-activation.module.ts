import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PaymentActivation } from './entities/payment-activation.entity';
import { PaymentLinkPaymentModule } from './payment-link-payment.module';
import { PaymentActivationRepository } from './repositories/payment-activation.repository';
import { PaymentActivationService } from './services/payment-activation.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentActivation]), SharedModule, BlockchainModule, PaymentLinkPaymentModule],
  controllers: [],
  providers: [PaymentActivationRepository, PaymentActivationService],
  exports: [PaymentActivationService],
})
export class PaymentActivationModule {}
