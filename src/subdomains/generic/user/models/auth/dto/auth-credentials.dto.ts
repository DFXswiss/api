import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';

export class AuthCredentialsDto {
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
  @ValidateIf((dto: AuthCredentialsDto) => CryptoService.isCardanoAddress(dto.address))
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  discountCode?: string;
}
