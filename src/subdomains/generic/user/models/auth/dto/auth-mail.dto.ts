import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Language } from 'src/shared/models/language/language.entity';

export class AuthMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  redirectUri?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  language?: Language;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.recommendationCode)
  recommendationCode?: string;
}
