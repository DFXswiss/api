import { Module } from '@nestjs/common';
import { AlchemyController } from './controllers/alchemy.controller';
import { AlchemyWebhookService } from './services/alchemy-webhook.service';
import { AlchemyService } from './services/alchemy.service';

@Module({
  imports: [],
  controllers: [AlchemyController],
  providers: [AlchemyService, AlchemyWebhookService],
  exports: [AlchemyService, AlchemyWebhookService],
})
export class AlchemyModule {}
