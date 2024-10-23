import { ApiProperty } from '@nestjs/swagger';
import { CreateBankAccountDto } from './create-bank-account.dto';

export class IbanDto {
  @ApiProperty()
  iban: string;
}

export class CreateIbanDto extends CreateBankAccountDto {}
