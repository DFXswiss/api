import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

export class CryptoPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
