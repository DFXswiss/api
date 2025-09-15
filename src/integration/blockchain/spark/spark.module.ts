import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { SparkService } from './spark.service';

@Module({
  imports: [SharedModule],
  providers: [SparkService],
  exports: [SparkService],
})
export class SparkModule {}