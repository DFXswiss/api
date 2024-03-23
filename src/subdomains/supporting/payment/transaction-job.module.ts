import { Module } from '@nestjs/common';
import { TransactionJobService } from './services/transaction-job.service';
import { TransactionModule } from './transaction.module';

@Module({
  imports: [TransactionModule],
  controllers: [],
  providers: [TransactionJobService],
  exports: [],
})
export class TransactionJobModule {}
