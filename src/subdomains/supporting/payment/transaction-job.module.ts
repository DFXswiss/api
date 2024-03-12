import { Module } from '@nestjs/common';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { FiatPayInModule } from '../fiat-payin/fiat-payin.module';
import { PayInModule } from '../payin/payin.module';
import { TransactionJobService } from './services/transaction-job.service';
import { TransactionModule } from './transaction.module';

@Module({
  imports: [BankTxModule, PayInModule, FiatPayInModule, TransactionModule, ReferralModule],
  controllers: [],
  providers: [TransactionJobService],
  exports: [],
})
export class TransactionJobModule {}
