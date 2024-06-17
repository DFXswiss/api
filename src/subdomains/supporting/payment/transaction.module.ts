import { Module, forwardRef } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { SpecialExternalAccountRepository } from './repositories/special-external-account.repository';
import { TransactionRepository } from './repositories/transaction.repository';
import { SpecialExternalAccountService } from './services/special-external-account.service';
import { TransactionJobService } from './services/transaction-job.service';
import { TransactionNotificationService } from './services/transaction-notification.service';
import { TransactionService } from './services/transaction.service';

@Module({
  imports: [NotificationModule, forwardRef(() => UserModule), SharedModule],
  controllers: [],
  providers: [
    TransactionRepository,
    TransactionService,
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
    TransactionNotificationService,
    TransactionJobService,
  ],
  exports: [TransactionService, SpecialExternalAccountService],
})
export class TransactionModule {}
