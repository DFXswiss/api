import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { DepositDto } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit.dto';
import { MinDeposit } from '../../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

export class CryptoRouteDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty({ type: DepositDto })
  deposit: DepositDto;

  @ApiProperty()
  volume: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty({ enum: Blockchain, deprecated: true })
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
