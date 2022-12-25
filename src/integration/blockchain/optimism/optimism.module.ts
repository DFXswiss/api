import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { OptimismService } from './optimism.service';

@Module({
  imports: [SharedModule],
  providers: [OptimismService],
  exports: [OptimismService],
})
export class OptimismModule {}
