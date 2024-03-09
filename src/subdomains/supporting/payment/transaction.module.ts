import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionService } from './services/transaction.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [TransactionRepository, TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
