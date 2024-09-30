import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { UserModule } from '../user/user.module';
import { KycAdminController } from './controllers/kyc-admin.controller';
import { KycClientController } from './controllers/kyc-client.controller';
import { KycController } from './controllers/kyc.controller';
import { KycLog } from './entities/kyc-log.entity';
import { KycStep } from './entities/kyc-step.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { StepLog } from './entities/step-log.entity';
import { KycLogRepository } from './repositories/kyc-log.repository';
import { KycStepRepository } from './repositories/kyc-step.repository';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { StepLogRepository } from './repositories/step-log.repository';
import { TfaLogRepository } from './repositories/tfa-log.repository';
import { DilisenseService } from './services/integration/dilisense.service';
import { FinancialService } from './services/integration/financial.service';
import { IdentService } from './services/integration/ident.service';
import { KycDocumentService } from './services/integration/kyc-document.service';
import { SumsubService } from './services/integration/sum-sub.service';
import { KycAdminService } from './services/kyc-admin.service';
import { KycClientService } from './services/kyc-client.service';
import { KycLogService } from './services/kyc-log.service';
import { KycNotificationService } from './services/kyc-notification.service';
import { KycService } from './services/kyc.service';
import { NameCheckService } from './services/name-check.service';
import { TfaService } from './services/tfa.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KycStep, KycLog, NameCheckLog, StepLog]),
    SharedModule,
    NotificationModule,
    forwardRef(() => UserModule),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => SellCryptoModule),
    TransactionModule,
    forwardRef(() => SupportIssueModule),
  ],
  controllers: [KycController, KycAdminController, KycClientController],
  providers: [
    KycService,
    KycAdminService,
    KycLogService,
    TfaService,
    KycDocumentService,
    NameCheckService,
    NameCheckLogRepository,
    StepLogRepository,
    TfaLogRepository,
    DilisenseService,
    IdentService,
    FinancialService,
    KycLogRepository,
    KycStepRepository,
    KycNotificationService,
    KycClientService,
    SumsubService,
  ],
  exports: [KycDocumentService, NameCheckService, KycAdminService, KycLogService, KycNotificationService],
})
export class KycModule {}
