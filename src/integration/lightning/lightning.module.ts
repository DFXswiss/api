import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LnUrlForwardController } from './controllers/lnurl-forward.controller';
import { LightningService } from './services/lightning.service';
import { LnUrlForwardService } from './services/lnurl-forward.service';

@Module({
  imports: [SharedModule],
  controllers: [LnUrlForwardController],
  providers: [LightningService, LnUrlForwardService],
  exports: [LightningService, LnUrlForwardService],
})
export class LightningModule {}
