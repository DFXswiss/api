import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';

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

  @ApiProperty({ description: 'Volume in CHF' })
  volume: number;

  @ApiProperty({ description: 'Annual volume in CHF' })
  annualVolume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty({ type: MinAmount, isArray: true })
  minDeposits: MinAmount[];

  @ApiProperty({ type: MinAmount })
  minFee: MinAmount;
}
