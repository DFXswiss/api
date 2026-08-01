import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ClientErrorController } from './client-error.controller';
import { ClientErrorService } from './client-error.service';
import { LogController } from './log.controller';
import { Log } from './log.entity';
import { LogRepository } from './log.repository';
import { LogService } from './log.service';

@Module({
  imports: [TypeOrmModule.forFeature([Log]), SharedModule],
  controllers: [LogController, ClientErrorController],
  providers: [LogRepository, LogService, ClientErrorService],
  exports: [LogService],
})
export class LogModule {}
