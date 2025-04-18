import { ApiProperty } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class CustodyAssetBalanceDto {
  @ApiProperty({ type: FiatDto, description: 'Asset' })
  asset: AssetDto;

  @ApiProperty({ description: 'Balance in asset' })
  balance: number;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in user selected currency' })
  totalBalance: number;

  @ApiProperty({ type: FiatDto, description: 'Currency selected by user' })
  currency: FiatDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Type of your requested order', isArray: true })
  assetBalances: CustodyAssetBalanceDto[];
}
