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

  @ApiProperty({ description: 'Balance in user selected currency' })
  value: number;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in user selected currency' })
  totalValue: number;

  @ApiProperty({ type: FiatDto, description: 'Currency selected by user' })
  currency: FiatDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Asset balances', isArray: true })
  balances: CustodyAssetBalanceDto[];
}

export class CustodyFiatValueDto {
  @ApiProperty({ description: 'Value in Swiss Franc' })
  chf: number;

  @ApiProperty({ description: 'Value in Euro' })
  eur: number;

  @ApiProperty({ description: 'Value in US Dollar' })
  usd: number;
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
