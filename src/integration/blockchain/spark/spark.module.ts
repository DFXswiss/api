import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { SparkService } from './spark.service';
import { SparkFeeService } from './services/spark-fee.service';

@Module({
  imports: [SharedModule],
  providers: [SparkService, SparkFeeService],
  exports: [SparkService, SparkFeeService],
})
export class SparkModule {}
