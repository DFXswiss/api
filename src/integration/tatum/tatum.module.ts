import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TatumController } from './controllers/tatum.controller';
import { TatumWebhookService } from './services/tatum-webhook.service';

@Module({
  imports: [SharedModule],
  controllers: [TatumController],
  providers: [TatumWebhookService],
  exports: [TatumWebhookService],
})
export class TatumModule {}
