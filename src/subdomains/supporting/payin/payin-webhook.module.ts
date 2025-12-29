import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { PayInWebhookController } from './controllers/payin-webhook.controller';
import { PayInWebHookService } from './services/payin-webhhook.service';

@Module({
  imports: [SharedModule],
  controllers: [PayInWebhookController],
  providers: [PayInWebHookService],
  exports: [PayInWebHookService],
})
export class PayInWebhookModule {}
