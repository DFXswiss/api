import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;

  @ApiPropertyOptional()
  sortOrder: number;
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
