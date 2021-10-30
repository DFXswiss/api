import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { BatchController } from './models/batch/batch.controller';
import { BatchRepository } from './models/batch/batch.repository';
import { BatchService } from './models/batch/batch.service';
import { CryptoInputRepository } from './models/crypto-input/crypto-input.repository';
import { CryptoInputService } from './models/crypto-input/crypto-input.service';
import { FiatInputController } from './models/fiat-input/fiat-input.controller';
import { FiatInputRepository } from './models/fiat-input/fiat-input.repository';
import { FiatInputService } from './models/fiat-input/fiat-input.service';
import { BuyPaymentRepository } from './models/payment/payment-buy.repository';
import { SellPaymentRepository } from './models/payment/payment-sell.repository';
import { PaymentController } from './models/payment/payment.controller';
import { PaymentService } from './models/payment/payment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BuyPaymentRepository,
      SellPaymentRepository,
      BatchRepository,
      CryptoInputRepository,
      FiatInputRepository,
    ]),
    SharedModule,
    AinModule,
    UserModule,
  ],
  controllers: [PaymentController, BatchController, FiatInputController],
  providers: [PaymentService, BatchService, CryptoInputService, FiatInputService],
  exports: [PaymentService],
})
export class PaymentModule {}
