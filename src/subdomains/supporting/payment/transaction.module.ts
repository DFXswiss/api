import { Module } from '@nestjs/common';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionService } from './services/transaction.service';

@Module({
  imports: [],
  controllers: [],
  providers: [TransactionRepository, TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
