import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { NameCheckLogController } from './controllers/name-check-log.controller';
import { KycLog } from './entities/kyc-log.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { DocumentStorageService } from './services/document-storage.service';
import { NameCheckLogService } from './services/name-check-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycLog, NameCheckLog]), SharedModule],
  controllers: [NameCheckLogController],
  providers: [DocumentStorageService, NameCheckLogService, NameCheckLogRepository],
  exports: [NameCheckLogService],
})
export class KycModule {}
