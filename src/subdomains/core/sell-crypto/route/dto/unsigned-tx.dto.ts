import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Eip7702DelegationDataDto {
  @ApiProperty({ description: 'Relayer address that will execute the transaction' })
  relayerAddress: string;

  @ApiProperty({ description: 'DelegationManager contract address' })
  delegationManagerAddress: string;

  @ApiProperty({ description: 'Delegator contract address (MetaMask delegator)' })
  delegatorAddress: string;

  @ApiProperty({ description: 'User account nonce for EIP-7702 authorization' })
  userNonce: number;

  @ApiProperty({ description: 'EIP-712 domain for delegation signature' })
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };

  @ApiProperty({ description: 'EIP-712 types for delegation signature' })
  types: {
    Delegation: Array<{ name: string; type: string }>;
    Caveat: Array<{ name: string; type: string }>;
  };

  @ApiProperty({ description: 'Delegation message to sign' })
  message: {
    delegate: string;
    delegator: string;
    authority: string;
    caveats: any[];
    salt: string;
  };
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
    type: Eip7702DelegationDataDto,
    description: 'EIP-7702 delegation data (only present if user has 0 native token)',
  })
  eip7702?: Eip7702DelegationDataDto;
}
