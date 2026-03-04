import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetCategory, AssetType } from '../asset.entity';

// TODO: remove
export enum FeeTier {
  TIER0 = 'Tier0',
  TIER1 = 'Tier1',
  TIER2 = 'Tier2',
  TIER3 = 'Tier3',
  TIER4 = 'Tier4',
}

export class AssetDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  chainId?: string;

  @ApiPropertyOptional()
  decimals?: number;

  @ApiPropertyOptional()
  explorerUrl?: string;

  @ApiProperty()
  uniqueName: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: AssetType })
  type: AssetType;

  @ApiProperty({ enum: AssetCategory })
  category: AssetCategory;

  @ApiProperty()
  dexName: string;

  @ApiProperty({ enum: FeeTier, deprecated: true })
  feeTier: FeeTier;

  @ApiProperty()
  comingSoon: boolean;

  @ApiProperty()
  buyable: boolean;

  @ApiProperty()
  sellable: boolean;

  @ApiProperty()
  cardBuyable: boolean;

  @ApiProperty()
  cardSellable: boolean;

  @ApiProperty()
  instantBuyable: boolean;

  @ApiProperty()
  instantSellable: boolean;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;

  @ApiPropertyOptional()
  sortOrder: number;
}

export class AssetInDto {
  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => Boolean(a.id || !(a.chainId || a.blockchain || a.evmChainId)))
  @IsInt()
  id?: number;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => Boolean(a.chainId || !a.id))
  @IsString()
  chainId?: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => Boolean(a.blockchain || (!a.id && !a.evmChainId)))
  @IsEnum(Blockchain)
  blockchain?: Blockchain;

  @ApiPropertyOptional({ description: 'Numeric EVM chain ID (e.g. 1, 56, 137)' })
  @IsOptional()
  @IsInt()
  evmChainId?: number;
}

export class AssetLimitsDto {
  @ApiProperty({ description: 'Minimum transaction volume (in asset)' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum transaction volume (in asset)' })
  maxVolume: number;
}

export class AssetDetailDto extends AssetDto {
  @ApiProperty()
  limits: AssetLimitsDto;
}
