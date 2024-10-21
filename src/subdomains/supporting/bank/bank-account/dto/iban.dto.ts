import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { UpdateUserBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/update-bank-data.dto';
import { IbanType, IsDfxIban } from '../is-dfx-iban.validator';

export class IbanDto {
  @ApiProperty()
  iban: string;
}

export class CreateIbanDto extends UpdateUserBankDataDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsDfxIban(IbanType.BOTH)
  @Transform(Util.trimAll)
  iban: string;
}
