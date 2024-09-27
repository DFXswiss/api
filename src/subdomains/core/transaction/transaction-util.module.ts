import { Module } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionUtilService } from './transaction-util.service';

@Module({
  imports: [SharedModule, PayInModule, BlockchainModule, BankModule],
  controllers: [],
  providers: [TransactionUtilService],
  exports: [TransactionUtilService],
})
export class TransactionUtilModule {}
