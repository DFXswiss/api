import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreateBankDataDto {
  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimIban)
  iban: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;
}
