import { ApiProperty } from '@nestjs/swagger';

export class FaucetRequestDto {
  @ApiProperty({ description: 'TX ID of faucet transaction' })
  txId: string;

  @ApiProperty({ description: 'TX amount of faucet transaction' })
  amount: number;
}
