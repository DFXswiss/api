import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { DepositDto } from '../../../../supporting/address-pool/deposit/dto/deposit.dto';
import { MinAmount } from '../../../../supporting/payment/dto/min-amount.dto';

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

  @ApiProperty({ description: 'Volume in CHF' })
  volume: number;

  @ApiProperty({ description: 'Annual volume in CHF' })
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
