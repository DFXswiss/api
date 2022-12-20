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
import { BankController } from './bank/bank.controller';
import { BankRepository } from './bank/bank.repository';
import { BankService } from './bank/bank.service';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { FiatOutputRepository } from './fiat-output/fiat-output.repository';
import { FiatOutputService } from './fiat-output/fiat-output.service';
import { FiatOutputController } from './fiat-output/fiat-output.controller';
import { BankTxRepeatController } from './bank-tx-repeat/bank-tx-repeat.controller';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankTxRepository,
      BankTxBatchRepository,
      BankAccountRepository,
      BankTxReturnRepository,
      BankTxRepeatRepository,
      BankRepository,
      FiatOutputRepository,
      BuyFiatRepository,
    ]),
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
    BankTxService,
    BankTxReturnService,
    BankTxRepeatService,
    BankAccountService,
    OlkypayService,
    FrickService,
    BankService,
    FiatOutputService,
  ],
  exports: [
    BankTxService,
    BankAccountService,
    OlkypayService,
    FrickService,
    BankService,
    BankTxRepeatService,
    FiatOutputService,
  ],
})
export class BankModule {}
