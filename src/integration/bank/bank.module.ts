import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { FiatRepublicWebhookController } from './controllers/fiat-republic-webhook.controller';
import { YapealWebhookController } from './controllers/yapeal-webhook.controller';
import { FiatRepublicEndUser } from './entities/fiat-republic-end-user.entity';
import { FiatRepublicPayee } from './entities/fiat-republic-payee.entity';
import { OlkyRecipient } from './entities/olky-recipient.entity';
import { FiatRepublicEndUserRepository } from './repositories/fiat-republic-end-user.repository';
import { FiatRepublicPayeeRepository } from './repositories/fiat-republic-payee.repository';
import { OlkyRecipientRepository } from './repositories/olky-recipient.repository';
import { FiatRepublicEndUserService } from './services/fiat-republic-end-user.service';
import { FiatRepublicPayeeService } from './services/fiat-republic-payee.service';
import { FiatRepublicWebhookService } from './services/fiat-republic-webhook.service';
import { FiatRepublicService } from './services/fiat-republic.service';
import { IbanService } from './services/iban.service';
import { BankFrickService } from './services/frick.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { YapealWebhookService } from './services/yapeal-webhook.service';
import { YapealService } from './services/yapeal.service';

@Module({
  imports: [TypeOrmModule.forFeature([OlkyRecipient, FiatRepublicEndUser, FiatRepublicPayee]), SharedModule],
  controllers: [YapealWebhookController, FiatRepublicWebhookController],
  providers: [
    BankFrickService,
    IbanService,
    OlkypayService,
    OlkyRecipientRepository,
    RaiffeisenService,
    YapealService,
    YapealWebhookService,
    FiatRepublicService,
    FiatRepublicEndUserRepository,
    FiatRepublicPayeeRepository,
    FiatRepublicEndUserService,
    FiatRepublicPayeeService,
    FiatRepublicWebhookService,
  ],
  exports: [
    BankFrickService,
    IbanService,
    OlkypayService,
    RaiffeisenService,
    YapealService,
    YapealWebhookService,
    FiatRepublicService,
    FiatRepublicEndUserService,
    FiatRepublicPayeeService,
    FiatRepublicWebhookService,
  ],
})
export class BankIntegrationModule {}
