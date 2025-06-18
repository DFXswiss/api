import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { Util } from 'src/shared/utils/util';
import { Moderator } from '../../user-data/user-data.entity';

export class SignInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  @Transform(Util.sanitize)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.signature)
  @Transform(Util.sanitize)
  signature: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.key)
  @ValidateIf(
    (dto: SignInDto) => CryptoService.isArweaveAddress(dto.address) || CryptoService.isCardanoAddress(dto.address),
  )
  @Transform(Util.sanitize)
  key?: string;

  @ApiPropertyOptional({ description: 'This field is deprecated, use "specialCode" instead.', deprecated: true })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  discountCode?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  specialCode?: string;

  @ApiPropertyOptional({ description: 'Moderator' })
  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;

  @ApiPropertyOptional({ description: 'IP region filter' })
  @IsOptional()
  region?: string | number;
}

export class OptionalSignUpDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  wallet?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'This field is deprecated, use "specialCode" instead.' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  discountCode?: string;

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

export class SignUpDto extends SignInDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  wallet?: string;
}
