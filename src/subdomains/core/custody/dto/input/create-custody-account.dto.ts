import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { Moderator } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CustodyAddressType } from '../../enums/custody';

export class CreateCustodyAccountDto {
  @ApiProperty({ enum: CustodyAddressType })
  @IsEnum(CustodyAddressType)
  addressType: CustodyAddressType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  wallet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  specialCode?: string;

  @ApiPropertyOptional({ description: 'Moderator' })
  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;
}
