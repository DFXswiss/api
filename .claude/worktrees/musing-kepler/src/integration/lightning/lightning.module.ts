import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LightningService } from './services/lightning.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [LightningService],
  exports: [LightningService],
})
export class LightningModule {}
