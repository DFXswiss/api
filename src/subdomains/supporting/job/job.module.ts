import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { JobAttempt } from './entities/job-attempt.entity';
import { Job } from './entities/job.entity';
import { JobController } from './job.controller';
import { JobAttemptRepository } from './repositories/job-attempt.repository';
import { JobRepository } from './repositories/job.repository';
import { JobDispatcherService } from './services/job-dispatcher.service';
import { JobMetricService } from './services/job-metric.service';
import { JobService } from './services/job.service';

@Module({
  imports: [TypeOrmModule.forFeature([Job, JobAttempt]), SharedModule],
  controllers: [JobController],
  providers: [JobRepository, JobAttemptRepository, JobService, JobDispatcherService, JobMetricService],
  exports: [JobService, JobDispatcherService],
})
export class JobModule {}
