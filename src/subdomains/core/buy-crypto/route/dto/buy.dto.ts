import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from 'src/mix/models/deposit/dto/min-deposit.dto';
import { StakingDto } from 'src/mix/models/staking/dto/staking.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { BuyType } from './buy-type.enum';

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
  asset: Asset;

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
