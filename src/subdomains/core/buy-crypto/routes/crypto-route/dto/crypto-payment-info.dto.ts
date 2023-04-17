import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';

export class CryptoPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty()
  blockchain: Blockchain;

  @ApiProperty({ type: MinAmount })
  minDeposit: MinAmount;

  @ApiProperty({ type: MinAmount })
  minFee: MinAmount;
}
