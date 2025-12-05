import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { RevolutService } from './services/revolut.service';
import { YapealService } from './services/yapeal.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [IbanService, OlkypayService, RevolutService, RaiffeisenService, YapealService],
  exports: [IbanService, OlkypayService, RevolutService, RaiffeisenService, YapealService],
})
export class BankIntegrationModule {}
