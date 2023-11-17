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
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { DilisenseService } from './services/dilisense.service';
import { DocumentStorageService } from './services/integration/document-storage.service';
import { IntrumService } from './services/integration/intrum.service';
import { KycLogService } from './services/kyc-log.service';
import { KycService } from './services/kyc.service';
import { NameCheckService } from './services/name-check.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycStep, KycLog, NameCheckLog]), SharedModule, forwardRef(() => UserModule)],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    DocumentStorageService,
    NameCheckService,
    NameCheckLogRepository,
    DilisenseService,
    IntrumService,
    KycLogService,
    KycLogRepository,
  ],
  exports: [DocumentStorageService, NameCheckService, KycLogService],
})
export class KycModule {}
