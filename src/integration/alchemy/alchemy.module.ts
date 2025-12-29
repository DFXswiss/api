import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { AlchemyController } from './controllers/alchemy.controller';
import { AlchemyWebhookService } from './services/alchemy-webhook.service';
import { AlchemyService } from './services/alchemy.service';

@Module({
  imports: [SharedModule],
  controllers: [AlchemyController],
  providers: [AlchemyService, AlchemyWebhookService],
  exports: [AlchemyService, AlchemyWebhookService],
})
export class AlchemyModule {}
