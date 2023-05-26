import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LightningService } from './lightning.service';
import { LnUrlForwardService } from './lnurl-forward.service';

@Module({
  imports: [SharedModule],
  providers: [LightningService, LnUrlForwardService],
  exports: [LightningService, LnUrlForwardService],
})
export class LightningModule {}
