import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LightningService } from './lightning.service';

@Module({
  imports: [SharedModule],
  providers: [LightningService],
  exports: [LightningService],
})
export class LightningModule {}
