import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { BuyType } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-type.enum';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';
import { MinDeposit } from '../../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

export class CryptoRouteDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ enum: BuyType })
  type: BuyType;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

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
