import { Module, forwardRef } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { TransactionUtilService } from './transaction-util.service';

@Module({
  imports: [SharedModule, PayInModule, BlockchainModule, BankModule, forwardRef(() => TransactionModule)],
  controllers: [],
  providers: [TransactionUtilService],
  exports: [TransactionUtilService],
})
export class TransactionUtilModule {}
