import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/ain/services/crypto.service';

export class CreateUserDto {
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
  @ValidateIf((dto: CreateUserDto) => CryptoService.isCardanoAddress(dto.address))
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.ref)
  usedRef: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  walletId: number;
}
