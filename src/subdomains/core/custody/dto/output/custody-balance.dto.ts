import { ApiProperty } from '@nestjs/swagger';
import { FiatValueDto } from 'src/shared/dto/fiat-value.dto';

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

  @ApiProperty({ description: 'Balances in fiat values' })
  value: FiatValueDto;
}

export class CustodyBalanceDto {
  @ApiProperty({ description: 'Total balance in fiat values' })
  totalValue: FiatValueDto;

  @ApiProperty({ type: CustodyAssetBalanceDto, description: 'Asset balances', isArray: true })
  balances: CustodyAssetBalanceDto[];
}

export class CustodyHistoryEntryDto {
  @ApiProperty({ description: 'Entry timestamp' })
  date: Date;

  @ApiProperty({ type: FiatValueDto, description: 'Fiat values' })
  value: FiatValueDto;
}

export class CustodyHistoryDto {
  @ApiProperty({ type: CustodyHistoryEntryDto, description: 'Total value history', isArray: true })
  totalValue: CustodyHistoryEntryDto[];
}
