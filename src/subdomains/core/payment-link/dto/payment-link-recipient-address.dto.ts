import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class PaymentLinkRecipientAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  houseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  zip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;
}
