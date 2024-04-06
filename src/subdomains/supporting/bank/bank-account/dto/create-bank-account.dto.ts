import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { IbanType, IsDfxIban } from '../is-dfx-iban.validator';
import { UpdateBankAccountDto } from './update-bank-account.dto';

export class CreateBankAccountDto extends UpdateBankAccountDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxIban(IbanType.BOTH)
  @Transform(Util.trim)
  iban: string;
}
