import { ApiProperty } from '@nestjs/swagger';

export class FaucetRequestDto {
  @ApiProperty({ description: 'Transaction ID of faucet transaction' })
  txId: string;

  @ApiProperty({ description: 'Transaction amount of faucet transaction' })
  amount: number;
}
