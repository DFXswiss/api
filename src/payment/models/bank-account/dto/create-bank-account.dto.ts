import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { UpdateBankAccountDto } from './update-bank-account.dto';

export class CreateBankAccountDto extends UpdateBankAccountDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;
}
