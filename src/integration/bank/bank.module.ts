import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';
import { RevolutService } from './services/revolut.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [IbanService, OlkypayService, RevolutService],
  exports: [IbanService, OlkypayService, RevolutService],
})
export class BankModule {}
