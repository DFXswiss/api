import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class PreparedTxDto {
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

  @ApiProperty({ description: 'Gas price in wei' })
  gasPrice: string;

  @ApiProperty({ description: 'Recommended gas limit' })
  gasLimit: string;

  @ApiProperty({ description: 'Chain ID' })
  chainId: number;

  @ApiProperty({ description: 'Blockchain network', enum: Blockchain })
  blockchain: Blockchain;

  @ApiProperty({ description: 'Deposit address where tokens will be received' })
  depositAddress: string;

  @ApiProperty({ description: 'Amount in asset units (human readable)' })
  amount: number;

  @ApiProperty({ description: 'Asset name' })
  asset: string;
}
