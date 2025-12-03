import { ApiProperty } from '@nestjs/swagger';

export class CustodyAssetDto {
  @ApiProperty({ description: 'Asset name' })
  name: string;

  @ApiProperty({ description: 'Asset description' })
  description: string;
}

export class CustodyFiatValueDto {
  @ApiProperty({ description: 'Value in Swiss Franc' })
  chf: number;

  @ApiProperty({ description: 'Value in Euro' })
  eur: number;

  @ApiProperty({ description: 'Value in US Dollar' })
  usd: number;
}

export class CustodyAssetBalanceDto {
  @ApiProperty({ type: CustodyAssetDto, description: 'Asset' })
  asset: CustodyAssetDto;

  @ApiProperty({ description: 'Balance in asset' })
  balance: number;

  @ApiProperty({ description: 'Price per unit in fiat values' })
  price: CustodyFiatValueDto;

  @ApiProperty({ description: 'Total value in fiat values' })
  value: CustodyFiatValueDto;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in fiat values' })
  totalValue: CustodyFiatValueDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Asset balances', isArray: true })
  balances: CustodyAssetBalanceDto[];
}

export class CustodyHistoryEntryDto {
  @ApiProperty({ description: 'Entry timestamp' })
  date: Date;

  @ApiProperty({ type: CustodyFiatValueDto, description: 'Fiat values' })
  value: CustodyFiatValueDto;
}

export class CustodyHistoryDto {
  @ApiProperty({ type: CustodyHistoryEntryDto, description: 'Total value history', isArray: true })
  totalValue: CustodyHistoryEntryDto[];
}
