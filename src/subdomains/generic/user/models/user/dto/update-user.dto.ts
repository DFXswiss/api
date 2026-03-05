import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Util } from 'src/shared/utils/util';

export class UpdateUserDto {
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

export class UpdateUserMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  @Transform(Util.toLowerCaseTrim)
  mail: string;
}
