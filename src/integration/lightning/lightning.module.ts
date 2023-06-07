import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { AlbyController } from './controllers/alby.controller';
import { LnUrlForwardController } from './controllers/lnurl-forward.controller';
import { LightningService } from './services/lightning.service';
import { LnUrlForwardService } from './services/lnurl-forward.service';

@Module({
  imports: [SharedModule],
  controllers: [LnUrlForwardController, AlbyController],
  providers: [LightningService, LnUrlForwardService],
  exports: [LightningService, LnUrlForwardService],
})
export class LightningModule {}
