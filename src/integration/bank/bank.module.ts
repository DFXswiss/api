import { Module } from '@nestjs/common';
import { IbanService } from './services/iban.service';

@Module({
  imports: [],
  controllers: [],
  providers: [IbanService],
  exports: [IbanService],
})
export class BankModule {}
