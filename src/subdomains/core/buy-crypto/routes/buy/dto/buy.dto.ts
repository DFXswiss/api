import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';

export class BuyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional()
  iban: string;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty()
  bankUsage: string;

  @ApiProperty({ description: 'volume in chf' })
  volume: number;

  @ApiProperty({ description: 'annualVolume in chf' })
  annualVolume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty({ type: MinAmount, isArray: true })
  minDeposits: MinAmount[];

  @ApiProperty({ type: MinAmount })
  minFee: MinAmount;
}
