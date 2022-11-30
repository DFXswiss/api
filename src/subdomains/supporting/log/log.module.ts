import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { LogController } from './log.controller';
import { LogRepository } from './log.repository';
import { LogService } from './log.service';

@Module({
  imports: [TypeOrmModule.forFeature([LogRepository]), SharedModule],
  controllers: [LogController],
  providers: [LogService],
  exports: [],
})
export class LogModule {}
