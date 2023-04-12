import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';

export class BuyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty()
  bankUsage: string;

  @ApiProperty()
  volume: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
