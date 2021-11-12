import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { BankController } from './models/bank/bank.controller';
import { BankService } from './models/bank/bank.service';
import { BatchController } from './models/batch/batch.controller';
import { BatchRepository } from './models/batch/batch.repository';
import { BatchService } from './models/batch/batch.service';
import { CryptoInputRepository } from './models/crypto-input/crypto-input.repository';
import { CryptoInputService } from './models/crypto-input/crypto-input.service';
import { BankTxBatchRepository } from './models/bank-tx/bank-tx-batch.repository';
import { BankTxController } from './models/bank-tx/bank-tx.controller';
import { BankTxRepository } from './models/bank-tx/bank-tx.repository';
import { BankTxService } from './models/bank-tx/bank-tx.service';
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
      BankTxRepository,
      BankTxBatchRepository,
    ]),
    SharedModule,
    AinModule,
    UserModule,
  ],
  controllers: [PaymentController, BatchController, BankTxController, BankController],
  providers: [PaymentService, BatchService, CryptoInputService, BankTxService, BankService],
  exports: [PaymentService],
})
export class PaymentModule {}
