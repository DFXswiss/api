import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DepositDto } from '../../../../supporting/address-pool/deposit/dto/deposit.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { MinDeposit } from '../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

export class SellDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: DepositDto })
  deposit: DepositDto;

  @ApiProperty()
  iban: string;

  @ApiProperty({ type: FiatDto, deprecated: true })
  fiat: FiatDto;

  @ApiProperty({ type: FiatDto })
  currency: FiatDto;

  @ApiProperty()
  volume: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  fee: number;

  // TODO: remove
  @ApiProperty({ enum: Blockchain, deprecated: true })
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
