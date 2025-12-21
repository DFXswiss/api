import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { SiftErrorLog } from './entities/sift-error-log.entity';
import { SiftErrorLogRepository } from './repositories/sift-error-log.repository';
import { SiftService } from './services/sift.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([SiftErrorLog])],
  controllers: [],
  providers: [SiftService, SiftErrorLogRepository],
  exports: [SiftService],
})
export class SiftModule {}
