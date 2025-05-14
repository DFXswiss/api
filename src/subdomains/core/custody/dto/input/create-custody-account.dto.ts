import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Moderator } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CustodyAddressType } from '../../enums/custody';

export class CreateCustodyAccountDto {
  @ApiProperty({ enum: CustodyAddressType })
  @IsEnum(CustodyAddressType)
  addressType: CustodyAddressType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  specialCode?: string;

  @ApiPropertyOptional({ description: 'Moderator' })
  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;
}
