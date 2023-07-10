import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { IsDfxIban } from '../is-dfx-iban.validator';
import { UpdateBankAccountDto } from './update-bank-account.dto';

export class CreateBankAccountDto extends UpdateBankAccountDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxIban()
  @Transform(Util.trim)
  iban: string;
}
