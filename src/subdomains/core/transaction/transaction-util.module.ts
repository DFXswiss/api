import { Module } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionUtilService } from './transaction-util.service';

@Module({
  imports: [SharedModule, PayInModule, BlockchainModule],
  controllers: [],
  providers: [TransactionUtilService],
  exports: [TransactionUtilService],
})
export class TransactionUtilModule {}
