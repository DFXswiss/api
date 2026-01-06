import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class Eip7702AuthorizationDto {
  @ApiProperty({ description: 'Chain ID' })
  @IsNumber()
  chainId: number;

  @ApiProperty({ description: 'Contract address to delegate to' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Account nonce' })
  @IsNumber()
  nonce: number;

  @ApiProperty({ description: 'Signature r component' })
  @IsString()
  @IsNotEmpty()
  r: string;

  @ApiProperty({ description: 'Signature s component' })
  @IsString()
  @IsNotEmpty()
  s: string;

  @ApiProperty({ description: 'Signature yParity (0 or 1)' })
  @IsNumber()
  yParity: number;
}

export class GaslessTransferDto {
  @ApiProperty({ description: 'EIP-7702 authorization signed by user', type: Eip7702AuthorizationDto })
  @IsNotEmpty()
  authorization: Eip7702AuthorizationDto;
}

export class Eip7702AuthorizationDataDto {
  @ApiProperty({ description: 'Smart account implementation contract address' })
  contractAddress: string;

  @ApiProperty({ description: 'Chain ID' })
  chainId: number;

  @ApiProperty({ description: 'Current nonce of the user account' })
  nonce: number;

  @ApiProperty({ description: 'EIP-712 typed data for signing' })
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

export class GaslessPaymentInfoDto {
  @ApiProperty({ description: 'Whether gasless transaction is available' })
  gaslessAvailable: boolean;

  @ApiProperty({ description: 'EIP-7702 authorization data for frontend signing', required: false })
  eip7702Authorization?: Eip7702AuthorizationDataDto;
}
