import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { YapealWebhookController } from './controllers/yapeal-webhook.controller';
import { OlkyPayerAccount } from './entities/olky-payer-account.entity';
import { OlkyPayerAccountRepository } from './repositories/olky-payer-account.repository';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { YapealWebhookService } from './services/yapeal-webhook.service';
import { YapealService } from './services/yapeal.service';

@Module({
  imports: [TypeOrmModule.forFeature([OlkyPayerAccount]), SharedModule],
  controllers: [YapealWebhookController],
  providers: [IbanService, OlkypayService, OlkyPayerAccountRepository, RaiffeisenService, YapealService, YapealWebhookService],
  exports: [IbanService, OlkypayService, RaiffeisenService, YapealService, YapealWebhookService],
})
export class BankIntegrationModule {}
