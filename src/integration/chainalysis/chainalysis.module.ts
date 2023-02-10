import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ChainalysisService } from './services/chainalysis.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [ChainalysisService],
  exports: [ChainalysisService],
})
export class ChainalysisModule {}
