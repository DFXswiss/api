import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { BankAccountController } from './bank-account/bank-account.controller';
import { BankAccount } from './bank-account/bank-account.entity';
import { BankAccountRepository } from './bank-account/bank-account.repository';
import { BankAccountService } from './bank-account/bank-account.service';
import { BankTxRepeatController } from './bank-tx-repeat/bank-tx-repeat.controller';
import { BankTxRepeat } from './bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatRepository } from './bank-tx-repeat/bank-tx-repeat.repository';
import { BankTxRepeatService } from './bank-tx-repeat/bank-tx-repeat.service';
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
import { OlkypayService } from './bank-tx/olkypay.service';
import { BankController } from './bank/bank.controller';
import { Bank } from './bank/bank.entity';
import { BankRepository } from './bank/bank.repository';
import { BankService } from './bank/bank.service';
import { FiatOutputController } from './fiat-output/fiat-output.controller';
import { FiatOutput } from './fiat-output/fiat-output.entity';
import { FiatOutputRepository } from './fiat-output/fiat-output.repository';
import { FiatOutputService } from './fiat-output/fiat-output.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankTx, BankTxBatch, BankAccount, BankTxReturn, BankTxRepeat, Bank, FiatOutput, BuyFiat]),
    SharedModule,
    BankIntegrationModule,
    NotificationModule,
    UserModule,
    forwardRef(() => BuyCryptoModule),
  ],

  controllers: [
    BankTxController,
    BankAccountController,
    BankTxReturnController,
    BankTxRepeatController,
    BankController,
    FiatOutputController,
  ],
  providers: [
    BankTxRepository,
    BankTxBatchRepository,
    BankAccountRepository,
    BankTxReturnRepository,
    BankTxRepeatRepository,
    BankRepository,
    FiatOutputRepository,
    BuyFiatRepository,
    BankTxService,
    BankTxReturnService,
    BankTxRepeatService,
    BankAccountService,
    OlkypayService,
    BankService,
    FiatOutputService,
  ],
  exports: [BankTxService, BankAccountService, OlkypayService, BankService, BankTxRepeatService, FiatOutputService],
})
export class BankModule {}
