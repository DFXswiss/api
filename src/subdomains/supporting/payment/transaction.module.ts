import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { TransactionAmlCheck } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { TransactionAmlCheckRepository } from 'src/subdomains/core/aml/repositories/transaction-aml-check.repository';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { BankModule } from '../bank/bank.module';
import { NotificationModule } from '../notification/notification.module';
import { TransactionAdminController } from './controllers/transaction-admin.controller';
import { TransactionRiskAssessment } from './entities/transaction-risk-assessment.entity';
import { Transaction } from './entities/transaction.entity';
import { SpecialExternalAccountRepository } from './repositories/special-external-account.repository';
import { TransactionRiskAssessmentRepository } from './repositories/transaction-risk-assessment.repository';
import { TransactionRepository } from './repositories/transaction.repository';
import { SpecialExternalAccountService } from './services/special-external-account.service';
import { TransactionNotificationService } from './services/transaction-notification.service';
import { TransactionRiskAssessmentService } from './services/transaction-risk-assessment.service';
import { TransactionService } from './services/transaction.service';

@Module({
  imports: [
    NotificationModule,
    forwardRef(() => UserModule),
    forwardRef(() => BankTxModule),
    forwardRef(() => BankModule),
    forwardRef(() => BuyCryptoModule),
    SharedModule,
    TypeOrmModule.forFeature([Transaction, TransactionRiskAssessment, TransactionAmlCheck]),
  ],
  controllers: [TransactionAdminController],
  providers: [
    TransactionRepository,
    TransactionService,
    TransactionRiskAssessmentRepository,
    TransactionRiskAssessmentService,
    TransactionAmlCheckRepository,
    TransactionAmlCheckService,
    SpecialExternalAccountService,
    SpecialExternalAccountRepository,
    TransactionNotificationService,
  ],
  exports: [
    TransactionService,
    SpecialExternalAccountService,
    TransactionNotificationService,
    TransactionAmlCheckService,
  ],
})
export class TransactionModule {}
