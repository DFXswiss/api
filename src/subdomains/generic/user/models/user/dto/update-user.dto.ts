import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsObject, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  language?: Language;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency?: Fiat;
}
