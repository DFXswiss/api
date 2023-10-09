import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankTxRepeatController } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.controller';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatRepository } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.repository';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { FiatOutputController } from '../bank-tx/fiat-output/fiat-output.controller';
import { FiatOutput } from '../bank-tx/fiat-output/fiat-output.entity';
import { FiatOutputRepository } from '../bank-tx/fiat-output/fiat-output.repository';
import { FiatOutputService } from '../bank-tx/fiat-output/fiat-output.service';
import { BankModule } from '../bank/bank.module';
import { NotificationModule } from '../notification/notification.module';
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
    TypeOrmModule.forFeature([BankTx, BankTxBatch, BankTxReturn, BankTxRepeat, FiatOutput]),
    SharedModule,
    BankIntegrationModule,
    NotificationModule,
    UserModule,
    forwardRef(() => BuyCryptoModule),
    BankModule,
  ],

  controllers: [BankTxController, BankTxReturnController, BankTxRepeatController, FiatOutputController],
  providers: [
    BankTxRepository,
    BankTxBatchRepository,
    BankTxReturnRepository,
    BankTxRepeatRepository,
    FiatOutputRepository,
    BuyFiatRepository,
    BankTxService,
    BankTxReturnService,
    BankTxRepeatService,
    FiatOutputService,
  ],
  exports: [BankTxService, BankTxRepeatService, FiatOutputService],
})
export class BankTxModule {}
