import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyPaymentRepository } from './models/payment/payment-buy.repository';
import { SellPaymentRepository } from './models/payment/payment-sell.repository';
import { PaymentController } from './models/payment/payment.controller';
import { PaymentService } from './models/payment/payment.service';

@Module({
  imports: [TypeOrmModule.forFeature([BuyPaymentRepository, SellPaymentRepository]), SharedModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
