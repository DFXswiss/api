import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { UserModule } from '../user/user.module';
import { KycController } from './api/kyc.controller';
import { KycAdminController } from './controllers/kyc-admin.controller';
import { KycLog } from './entities/kyc-log.entity';
import { KycStep } from './entities/kyc-step.entity';
import { MergeLog } from './entities/merge-log.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { StepLog } from './entities/step-log.entity';
import { KycLogRepository } from './repositories/kyc-log.repository';
import { KycStepRepository } from './repositories/kyc-step.repository';
import { MergeLogRepository } from './repositories/merge-log.repository';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { StepLogRepository } from './repositories/step-log.repository';
import { TfaLogRepository } from './repositories/tfa-log.repository';
import { DilisenseService } from './services/integration/dilisense.service';
import { DocumentStorageService } from './services/integration/document-storage.service';
import { FinancialService } from './services/integration/financial.service';
import { IdentService } from './services/integration/ident.service';
import { KycAdminService } from './services/kyc-admin.service';
import { KycNotificationService } from './services/kyc-notification.service';
import { KycService } from './services/kyc.service';
import { NameCheckService } from './services/name-check.service';
import { TfaService } from './services/tfa.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KycStep, KycLog, NameCheckLog, StepLog, MergeLog]),
    SharedModule,
    NotificationModule,
    forwardRef(() => UserModule),
  ],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    KycAdminService,
    TfaService,
    DocumentStorageService,
    NameCheckService,
    NameCheckLogRepository,
    StepLogRepository,
    TfaLogRepository,
    DilisenseService,
    IdentService,
    FinancialService,
    KycLogRepository,
    MergeLogRepository,
    KycStepRepository,
    KycNotificationService,
  ],
  exports: [DocumentStorageService, NameCheckService, KycAdminService, KycNotificationService, MergeLogRepository],
})
export class KycModule {}
