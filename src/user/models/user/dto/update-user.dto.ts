import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsNumber, Matches, IsObject, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(\w{1,3}-\w{1,3})$/)
  usedRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  refFeePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  language?: Language;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency?: Fiat;
}
