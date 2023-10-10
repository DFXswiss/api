import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IbanService } from './services/iban.service';
import { OlkypayService } from './services/olkypay.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [IbanService, OlkypayService],
  exports: [IbanService, OlkypayService],
})
export class BankModule {}
