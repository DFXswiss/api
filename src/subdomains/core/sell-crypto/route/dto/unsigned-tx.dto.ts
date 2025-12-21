import { ApiProperty } from '@nestjs/swagger';

export class UnsignedTxDto {
  @ApiProperty({ description: 'Chain ID' })
  chainId: number;

  @ApiProperty({ description: 'Sender address (user wallet)' })
  from: string;

  @ApiProperty({ description: 'Recipient address (deposit address or token contract)' })
  to: string;

  @ApiProperty({ description: 'Transaction data (empty for native, encoded transfer for ERC20)' })
  data: string;

  @ApiProperty({ description: 'Value in wei (for native token transfers)' })
  value: string;

  @ApiProperty({ description: 'Transaction nonce' })
  nonce: number;

  @ApiProperty({ description: 'Recommended gas price in wei' })
  gasPrice: string;

  @ApiProperty({ description: 'Recommended gas limit' })
  gasLimit: string;
}
