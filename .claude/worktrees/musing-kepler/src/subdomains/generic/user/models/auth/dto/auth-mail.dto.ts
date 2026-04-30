import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Language } from 'src/shared/models/language/language.entity';
import { Util } from 'src/shared/utils/util';

export class AuthMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  @Transform(Util.toLowerCaseTrim)
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
