import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ArchiveBatch } from './archive-batch.entity';
import { ArchiveBatchRepository } from './archive-batch.repository';
import { ArchiveFile } from './archive-file.entity';
import { ArchiveFileRepository } from './archive-file.repository';
import { ArchiveScheduler } from './archive.scheduler';
import { ArchiveService } from './archive.service';
import { OpenTimestampsService } from './opentimestamps.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([ArchiveBatch, ArchiveFile])],
  controllers: [],
  providers: [ArchiveBatchRepository, ArchiveFileRepository, ArchiveService, OpenTimestampsService, ArchiveScheduler],
  exports: [ArchiveService, OpenTimestampsService],
})
export class ArchiveModule {}
