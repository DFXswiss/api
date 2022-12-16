import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class BankDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.trimIban)
  iban: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active: boolean;
}
