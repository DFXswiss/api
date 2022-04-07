import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
