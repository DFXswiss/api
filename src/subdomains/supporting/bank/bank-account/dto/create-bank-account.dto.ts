import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { IbanType, IsDfxIban } from '../is-dfx-iban.validator';

export class CreateBankAccountDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxIban(IbanType.BOTH)
  @Transform(Util.trimAll)
  iban: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label: string;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  preferredCurrency: Fiat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active = true;
}
