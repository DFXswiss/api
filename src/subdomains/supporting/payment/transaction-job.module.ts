import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TransactionJobService } from './services/transaction-job.service';
import { TransactionModule } from './transaction.module';

@Module({
  imports: [TransactionModule, SharedModule],
  controllers: [],
  providers: [TransactionJobService],
  exports: [],
})
export class TransactionJobModule {}
