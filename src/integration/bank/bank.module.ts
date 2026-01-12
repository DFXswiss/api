import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { YapealWebhookController } from './controllers/yapeal-webhook.controller';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { YapealWebhookService } from './services/yapeal-webhook.service';
import { YapealService } from './services/yapeal.service';

@Module({
  imports: [SharedModule],
  controllers: [YapealWebhookController],
  providers: [IbanService, OlkypayService, RaiffeisenService, YapealService, YapealWebhookService],
  exports: [IbanService, OlkypayService, RaiffeisenService, YapealService, YapealWebhookService],
})
export class BankIntegrationModule {}
