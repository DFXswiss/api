import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TatumController } from './controllers/tatum.controller';
import { TatumWebhookService } from './services/tatum-webhook.service';
import { TatumProvider } from './tatum.provider';

@Module({
  imports: [SharedModule],
  controllers: [TatumController],
  providers: [TatumProvider, TatumWebhookService],
  exports: [TatumProvider, TatumWebhookService],
})
export class TatumModule {}
