import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from '../user/user.module';
import { KycAdminController } from './controllers/name-check-log.controller';
import { KycLog } from './entities/kyc-log.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { DilisenseService } from './services/dilisense.service';
import { DocumentStorageService } from './services/document-storage.service';
import { NameCheckService } from './services/name-check-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycLog, NameCheckLog]), SharedModule, forwardRef(() => UserModule)],
  controllers: [KycAdminController],
  providers: [DocumentStorageService, NameCheckService, NameCheckLogRepository, DilisenseService],
  exports: [NameCheckService],
})
export class KycModule {}
