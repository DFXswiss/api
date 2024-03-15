import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankTxRepeatController } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.controller';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatRepository } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.repository';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankModule } from '../bank/bank.module';
import { NotificationModule } from '../notification/notification.module';
import { TransactionModule } from '../payment/transaction.module';
import { BankTxReturnController } from './bank-tx-return/bank-tx-return.controller';
import { BankTxReturn } from './bank-tx-return/bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return/bank-tx-return.repository';
import { BankTxReturnService } from './bank-tx-return/bank-tx-return.service';
import { BankTxBatch } from './bank-tx/bank-tx-batch.entity';
import { BankTxBatchRepository } from './bank-tx/bank-tx-batch.repository';
import { BankTxController } from './bank-tx/bank-tx.controller';
import { BankTx } from './bank-tx/bank-tx.entity';
import { BankTxRepository } from './bank-tx/bank-tx.repository';
import { BankTxService } from './bank-tx/bank-tx.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankTx, BankTxBatch, BankTxReturn, BankTxRepeat]),
    SharedModule,
    BankIntegrationModule,
    NotificationModule,
    forwardRef(() => UserModule),
    forwardRef(() => BuyCryptoModule),
    BankModule,
    TransactionModule,
  ],

  controllers: [BankTxController, BankTxReturnController, BankTxRepeatController],
  providers: [
    BankTxRepository,
    BankTxBatchRepository,
    BankTxReturnRepository,
    BankTxRepeatRepository,
    BankTxService,
    BankTxReturnService,
    BankTxRepeatService,
  ],
  exports: [BankTxService, BankTxRepeatService],
})
export class BankTxModule {}
