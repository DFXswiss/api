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

export class CustodyValues {
  @ApiProperty({ description: 'Custody value in Swiss Franc' })
  chf: number;

  @ApiProperty({ description: 'Custody value in Euro' })
  eur: number;

  @ApiProperty({ description: 'Custody value in US Dollar' })
  usd: number;
}

export class CustodyHistoryEntryDto {
  @ApiProperty({ description: 'Date of the custody history entry' })
  date: Date;

  @ApiProperty({ type: CustodyValues, description: 'Values of a custody history entry' })
  value: CustodyValues;
}

export class CustodyHistoryDto {
  @ApiProperty({ type: CustodyHistoryEntryDto, description: 'All custody history entries', isArray: true })
  totalValue: CustodyHistoryEntryDto[];
}
