import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';
import { RaiffeisenService } from './services/raiffeisen.service';
import { RevolutService } from './services/revolut.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [IbanService, OlkypayService, RevolutService, RaiffeisenService],
  exports: [IbanService, OlkypayService, RevolutService, RaiffeisenService],
})
export class BankIntegrationModule {}
