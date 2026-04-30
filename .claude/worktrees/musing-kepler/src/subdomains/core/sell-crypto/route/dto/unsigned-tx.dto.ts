import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Eip5792CallDto {
  @ApiProperty({ description: 'Target contract address' })
  to: string;

  @ApiProperty({ description: 'Encoded call data' })
  data: string;

  @ApiProperty({ description: 'Value in wei (usually 0x0 for ERC20 transfers)' })
  value: string;
}

export class Eip5792DataDto {
  @ApiProperty({ description: 'Pimlico paymaster service URL for gas sponsorship' })
  paymasterUrl: string;

  @ApiProperty({ description: 'Chain ID' })
  chainId: number;

  @ApiProperty({ type: [Eip5792CallDto], description: 'Array of calls to execute' })
  calls: Eip5792CallDto[];
}

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

  @ApiPropertyOptional({
    type: Eip5792DataDto,
    description: 'EIP-5792 wallet_sendCalls data (only present if user has 0 native token for gas)',
  })
  eip5792?: Eip5792DataDto;
}
