import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { BaseBankAccountDto } from './base-bank-account.dto';

export class CreateBankAccountDto extends BaseBankAccountDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;
}
