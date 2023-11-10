import { Module } from '@nestjs/common';
import { AlchemyController } from './controllers/alchemy.controller';
import { AlchemyWebhookService } from './services/alchemy-webhook.service';

@Module({
  imports: [],
  controllers: [AlchemyController],
  providers: [AlchemyWebhookService],
  exports: [AlchemyWebhookService],
})
export class AlchemyModule {}
