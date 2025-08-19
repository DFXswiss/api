import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { BankDataType } from '../bank-data.entity';

export class CreateBankDataDto {
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimAll)
  iban: string;

  @IsOptional()
  @IsString()
  bic?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsEnum(BankDataType)
  type?: BankDataType;
}
