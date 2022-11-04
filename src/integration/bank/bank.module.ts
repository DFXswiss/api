import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IbanService } from './services/iban.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [IbanService],
  exports: [IbanService],
})
export class BankModule {}
