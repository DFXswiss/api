import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { CustodyAddressType } from '../../enums/custody';

export class CreateCustodyAccountDto {
  @ApiProperty()
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
}
