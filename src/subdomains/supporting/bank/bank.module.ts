import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { NotificationModule } from '../notification/notification.module';
import { BankAccountController } from './bank-account/bank-account.controller';
import { BankAccountRepository } from './bank-account/bank-account.repository';
import { BankAccountService } from './bank-account/bank-account.service';
import { BankTxRepeatRepository } from './bank-tx-repeat/bank-tx-repeat.repository';
import { BankTxRepeatService } from './bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnController } from './bank-tx-return/bank-tx-return.controller';
import { BankTxReturnRepository } from './bank-tx-return/bank-tx-return.repository';
import { BankTxReturnService } from './bank-tx-return/bank-tx-return.service';
import { BankTxBatchRepository } from './bank-tx/bank-tx-batch.repository';
import { BankTxController } from './bank-tx/bank-tx.controller';
import { BankTxRepository } from './bank-tx/bank-tx.repository';
import { BankTxService } from './bank-tx/bank-tx.service';
import { FrickService } from './bank-tx/frick.service';
import { OlkypayService } from './bank-tx/olkypay.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankTxRepository,
      BankTxBatchRepository,
      BankAccountRepository,
      BankTxReturnRepository,
      BankTxRepeatRepository,
    ]),
    SharedModule,
    NotificationModule,
    forwardRef(() => BuyCryptoModule),
  ],
  controllers: [BankTxController, BankAccountController, BankTxReturnController],
  providers: [
    BankTxService,
    BankTxReturnService,
    BankTxRepeatService,
    BankAccountService,
    OlkypayService,
    FrickService,
  ],
  exports: [BankTxService, BankAccountService, OlkypayService, FrickService],
})
export class BankModule {}
