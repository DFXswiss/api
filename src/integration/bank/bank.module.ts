import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { YapealWebhookController } from './controllers/yapeal-webhook.controller';
import { OlkyRecipient } from './entities/olky-recipient.entity';
import { OlkyRecipientRepository } from './repositories/olky-recipient.repository';
import { IbanService } from './services/iban.service';
import { BankFrickService } from './services/frick.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { YapealWebhookService } from './services/yapeal-webhook.service';
import { YapealService } from './services/yapeal.service';

@Module({
  imports: [TypeOrmModule.forFeature([OlkyRecipient]), SharedModule],
  controllers: [YapealWebhookController],
  providers: [
    BankFrickService,
    IbanService,
    OlkypayService,
    OlkyRecipientRepository,
    RaiffeisenService,
    YapealService,
    YapealWebhookService,
  ],
  exports: [BankFrickService, IbanService, OlkypayService, RaiffeisenService, YapealService, YapealWebhookService],
})
export class BankIntegrationModule {}
