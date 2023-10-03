import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { MinAmount } from '../../../../../shared/payment/dto/min-amount.dto';
import { DepositDto } from '../../../../supporting/address-pool/deposit/dto/deposit.dto';

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
