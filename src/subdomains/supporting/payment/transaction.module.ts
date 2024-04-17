import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { SpecialExternalAccountRepository } from './repositories/special-external-account.repository';
import { TransactionRepository } from './repositories/transaction.repository';
import { SpecialExternalAccountService } from './services/special-external-account.service';
import { TransactionService } from './services/transaction.service';

@Module({
  imports: [NotificationModule],
  controllers: [],
  providers: [
    TransactionRepository,
    TransactionService,
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
  ],
  exports: [TransactionService, SpecialExternalAccountService],
})
export class TransactionModule {}
