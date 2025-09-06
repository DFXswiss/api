import { Module } from '@nestjs/common';
import { SparkService } from './services/spark.service';

@Module({
  providers: [SparkService],
  exports: [SparkService],
})
export class SparkModule {}