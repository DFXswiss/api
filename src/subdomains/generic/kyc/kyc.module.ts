import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from '../user/user.module';
import { KycController } from './api/kyc.controller';
import { KycAdminController } from './controllers/kyc-admin.controller';
import { KycLog } from './entities/kyc-log.entity';
import { KycStep } from './entities/kyc-step.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { KycLogRepository } from './repositories/kyc-log.repository';
import { KycStepRepository } from './repositories/kyc-step.repository';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { DilisenseService } from './services/integration/dilisense.service';
import { DocumentStorageService } from './services/integration/document-storage.service';
import { FinancialService } from './services/integration/financial.service';
import { IdentService } from './services/integration/ident.service';
import { KycAdminService } from './services/kyc-admin.service';
import { KycService } from './services/kyc.service';
import { NameCheckService } from './services/name-check.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycStep, KycLog, NameCheckLog]), SharedModule, forwardRef(() => UserModule)],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    KycAdminService,
    DocumentStorageService,
    NameCheckService,
    NameCheckLogRepository,
    DilisenseService,
    IdentService,
    FinancialService,
    KycLogRepository,
    KycStepRepository,
  ],
  exports: [DocumentStorageService, NameCheckService, KycAdminService],
})
export class KycModule {}
