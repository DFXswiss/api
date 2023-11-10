import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { KycLogRepository } from './repositories/kyc-log.repository';
import { KycLogService } from './services/kyc-log.service';
import { NameCheckService } from './services/name-check.service';

@Module({
  imports: [TypeOrmModule.forFeature([]), SharedModule],
  controllers: [],
  providers: [NameCheckService, KycLogService, KycLogRepository],
  exports: [],
})
export class KycModule {}
