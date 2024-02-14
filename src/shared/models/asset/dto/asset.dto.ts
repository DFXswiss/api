import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetCategory, AssetType } from '../asset.entity';

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
