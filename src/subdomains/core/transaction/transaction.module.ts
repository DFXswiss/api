import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TransactionRepository } from './transaction.repository';
import { TransactionService } from './transaction.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [TransactionService, TransactionRepository],
  exports: [TransactionService],
})
export class TransactionModule {}
