import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { BankDataType } from '../bank-data.entity';

export class CreateBankDataDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  iban: string;

  @IsOptional()
  @IsBoolean()
  active: boolean;

  @IsOptional()
  @IsEnum(BankDataType)
  type: BankDataType;
}
