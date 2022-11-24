import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from './core/core.module';
import { GenericModule } from './generic/generic.module';
import { LogController } from './supporting/log/log.controller';
import { LogRepository } from './supporting/log/log.repository';
import { LogService } from './supporting/log/log.service';
import { SupportingModule } from './supporting/supporting.module';

@Module({
  imports: [TypeOrmModule.forFeature([LogRepository]), CoreModule, GenericModule, SupportingModule],
  controllers: [LogController],
  providers: [LogService],
  exports: [CoreModule],
})
export class SubdomainsModule {}
