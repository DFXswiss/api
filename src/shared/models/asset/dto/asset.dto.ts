import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetCategory, AssetType, FeeTier } from '../asset.entity';

export class AssetDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  chainId: string;

  @ApiProperty()
  uniqueName: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: AssetType, enumName: 'AssetType' })
  type: AssetType;

  @ApiProperty({ enum: AssetCategory, enumName: 'AssetCategory' })
  category: AssetCategory;

  @ApiProperty()
  dexName: string;

  @ApiProperty({ enum: FeeTier, enumName: 'FeeTier' })
  feeTier: FeeTier;

  @ApiProperty()
  comingSoon: boolean;

  @ApiProperty()
  buyable: boolean;

  @ApiProperty()
  sellable: boolean;

  @ApiProperty({ enum: Blockchain, enumName: 'Blockchain' })
  blockchain: Blockchain;
}
