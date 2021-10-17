import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BatchController } from './models/batch/batch.controller';
import { BatchRepository } from './models/batch/batch.repository';
import { BatchService } from './models/batch/batch.service';
import { BuyPaymentRepository } from './models/payment/payment-buy.repository';
import { SellPaymentRepository } from './models/payment/payment-sell.repository';
import { PaymentController } from './models/payment/payment.controller';
import { PaymentService } from './models/payment/payment.service';

@Module({
  imports: [TypeOrmModule.forFeature([BuyPaymentRepository, SellPaymentRepository, BatchRepository]), SharedModule],
  controllers: [PaymentController, BatchController],
  providers: [PaymentService, BatchService],
  exports: [PaymentService],
})
export class PaymentModule {}
