import { ApiProperty } from '@nestjs/swagger';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class CustodyAssetDto {
  @ApiProperty({ description: 'Asset name' })
  name: string;

  @ApiProperty({ description: 'Asset description' })
  description: string;
}

export class CustodyAssetBalanceDto {
  @ApiProperty({ type: FiatDto, description: 'Asset' })
  asset: CustodyAssetDto;

  @ApiProperty({ description: 'Balance in asset' })
  balance: number;

  @ApiProperty({ description: 'Balance in user selected currency' })
  balanceInCurrency: number;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in user selected currency' })
  totalBalance: number;

  @ApiProperty({ type: FiatDto, description: 'Currency selected by user' })
  currency: FiatDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Asset balances', isArray: true })
  assetBalances: CustodyAssetBalanceDto[];
}
