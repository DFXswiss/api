import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IsAssetIdentifier } from '../asset-in-validator';
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
  @IsOptional()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  chainId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  blockchain?: Blockchain;

  @IsAssetIdentifier({
    message: 'Either “id” or both ‘chainId’ and “blockchain” must be specified.',
  })
  private readonly _assetIdentifierValidator!: boolean; // Dummy-Property for validation
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
