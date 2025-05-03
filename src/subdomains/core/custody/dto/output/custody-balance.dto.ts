import { ApiProperty } from '@nestjs/swagger';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class CustodyAssetDto {
  @ApiProperty({ description: 'Asset name' })
  name: string;

  @ApiProperty({ description: 'Asset description' })
  description: string;
}

export class CustodyAssetBalanceDto {
  @ApiProperty({ type: CustodyAssetDto, description: 'Asset' })
  asset: CustodyAssetDto;

  @ApiProperty({ description: 'Balance in asset' })
  balance: number;

  @ApiProperty({ description: 'Balance in EUR' })
  valueInEur: number;

  @ApiProperty({ description: 'Balance in CHF' })
  valueInChf: number;

  @ApiProperty({ description: 'Balance in USD' })
  valueInUsd: number;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in EUR' })
  totalValueInEur: number;

  @ApiProperty({ description: 'Total balance in CHF' })
  totalValueInChf: number;

  @ApiProperty({ description: 'Total balance in USD' })
  totalValueInUsd: number;

  @ApiProperty({ type: FiatDto, description: 'Currency selected by user' })
  currency: FiatDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Asset balances', isArray: true })
  balances: CustodyAssetBalanceDto[];
}
