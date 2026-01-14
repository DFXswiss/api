import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { EvmBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Moderator } from '../../user-data/user-data.enum';
import { WalletType } from '../../user/user.enum';

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

  @ApiPropertyOptional({
    description:
      'Blockchain for smart contract wallet signature verification (ERC-1271). Required for contract wallets on non-Ethereum chains.',
    enum: EvmBlockchains,
  })
  @IsOptional()
  @IsIn(EvmBlockchains)
  blockchain?: Blockchain;

  @ApiPropertyOptional({ description: 'This field is deprecated, use "specialCode" instead.', deprecated: true })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  specialCode?: string;

  @ApiPropertyOptional({ description: 'Moderator' })
  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;

  @ApiPropertyOptional({ description: 'IP region filter' })
  @IsOptional()
  region?: string | number;

  @ApiPropertyOptional({ description: 'Wallet type' })
  @IsOptional()
  @IsEnum(WalletType)
  walletType?: WalletType;
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

  @ApiPropertyOptional({ description: 'Moderator' })
  @IsOptional()
  @IsEnum(Moderator)
  moderator?: Moderator;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.recommendationCode)
  recommendationCode?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(GetConfig().formats.recommendationCode)
  recommendationCode?: string;
}
