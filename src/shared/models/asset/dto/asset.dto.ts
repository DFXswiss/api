import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
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
  @ApiPropertyOptional({ description: 'DFX asset ID. Use either id alone OR blockchain/evmChainId with chainId.' })
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => a.id != null || !(a.blockchain || a.evmChainId))
  @IsInt()
  id?: number;

  @ApiPropertyOptional({
    description: 'On-chain contract address (for tokens). If omitted with blockchain/evmChainId, uses native coin.',
  })
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => a.chainId != null)
  @IsString()
  chainId?: string;

  @ApiPropertyOptional({
    description: 'Blockchain name (e.g. Ethereum, Polygon). Use with chainId.',
  })
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => a.blockchain != null || (!a.id && !a.evmChainId))
  @IsEnum(Blockchain)
  blockchain?: Blockchain;

  @ApiPropertyOptional({
    description: 'Numeric EVM chain ID (e.g. 1 for Ethereum, 137 for Polygon). Alternative to blockchain.',
  })
  @IsNotEmpty()
  @ValidateIf((a: AssetInDto) => a.evmChainId != null || (!a.id && !a.blockchain))
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
