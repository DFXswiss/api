import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';

export class SignInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.signature)
  signature: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.key)
  @ValidateIf(
    (dto: SignInDto) => CryptoService.isArweaveAddress(dto.address) || CryptoService.isCardanoAddress(dto.address),
  )
  key?: string;

  @ApiPropertyOptional({ description: 'This field is deprecated, use "specialCode" instead.', deprecated: true })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  specialCode?: string;

  @ApiPropertyOptional({ description: 'IP region filter' })
  @IsOptional()
  region?: string | number;
}

export class OptionalSignUpDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'This field is deprecated, use "specialCode" instead.' })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  specialCode?: string;
}

export class SignUpDto extends SignInDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.ref)
  usedRef?: string;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet?: string;
}
