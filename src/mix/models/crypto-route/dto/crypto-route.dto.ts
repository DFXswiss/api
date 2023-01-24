import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { BuyType } from 'src/subdomains/core/buy-crypto/route/dto/buy-type.enum';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';
import { StakingDto } from '../../staking/dto/staking.dto';

export class CryptoRouteDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ enum: BuyType })
  type: BuyType;

  @ApiProperty({ type: AssetDto })
  asset: Asset;

  @ApiProperty()
  volume: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty()
  refBonus: number;

  @ApiProperty({ type: StakingDto })
  staking: StakingDto;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
