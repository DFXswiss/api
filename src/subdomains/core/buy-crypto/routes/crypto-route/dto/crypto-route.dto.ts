import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { DepositDto } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit.dto';
import { MinAmount } from '../../../../../../shared/payment/dto/min-amount.dto';

export class CryptoRouteDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty({ type: DepositDto })
  deposit: DepositDto;

  @ApiProperty({ description: 'volume in chf' })
  volume: number;

  @ApiProperty({ description: 'annualVolume in chf' })
  annualVolume: number;

  @ApiProperty()
  fee: number;

  // TODO: remove
  @ApiProperty({ enum: Blockchain, deprecated: true })
  blockchain: Blockchain;

  @ApiProperty({ type: MinAmount, isArray: true })
  minDeposits: MinAmount[];

  @ApiProperty({ type: MinAmount })
  minFee: MinAmount;
}
