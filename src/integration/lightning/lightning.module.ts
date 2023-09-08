import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LnUrlPForwardController } from './controllers/lnurlp-forward.controller';
import { LnUrlWForwardController } from './controllers/lnurlw-forward.controller';
import { LightningService } from './services/lightning.service';
import { LnUrlForwardService } from './services/lnurl-forward.service';

@Module({
  imports: [SharedModule],
  controllers: [LnUrlPForwardController, LnUrlWForwardController],
  providers: [LightningService, LnUrlForwardService],
  exports: [LightningService, LnUrlForwardService],
})
export class LightningModule {}
