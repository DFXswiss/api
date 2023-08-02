import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

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
}
