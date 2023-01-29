import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { BuyType } from './buy-type.enum';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';

export class BuyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  iban: string;

  @ApiProperty({ enum: BuyType })
  type: BuyType;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty({ type: StakingDto })
  staking: StakingDto;

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
