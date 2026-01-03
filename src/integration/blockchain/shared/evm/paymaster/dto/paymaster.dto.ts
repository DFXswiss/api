import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// ERC-7677 JSON-RPC Request
export class PaymasterRpcRequest {
  @ApiProperty()
  @IsString()
  jsonrpc: string;

  @ApiProperty()
  @IsString()
  method: string;

  @ApiProperty()
  @IsArray()
  params: any[];

  @ApiProperty()
  @IsNumber()
  id: number;
}

// ERC-7677 JSON-RPC Response
export class PaymasterRpcResponse {
  @ApiProperty()
  jsonrpc: string;

  @ApiPropertyOptional()
  result?: any;

  @ApiPropertyOptional()
  error?: {
    code: number;
    message: string;
    data?: any;
  };

  @ApiProperty()
  id: number;
}

// UserOperation for ERC-4337 / EIP-7702 hybrid
export class UserOperationDto {
  @ApiProperty()
  @IsString()
  sender: string;

  @ApiProperty()
  @IsString()
  nonce: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  factory?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  factoryData?: string;

  @ApiProperty()
  @IsString()
  callData: string;

  @ApiProperty()
  @IsString()
  callGasLimit: string;

  @ApiProperty()
  @IsString()
  verificationGasLimit: string;

  @ApiProperty()
  @IsString()
  preVerificationGas: string;

  @ApiProperty()
  @IsString()
  maxFeePerGas: string;

  @ApiProperty()
  @IsString()
  maxPriorityFeePerGas: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paymaster?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paymasterVerificationGasLimit?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paymasterPostOpGasLimit?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paymasterData?: string;

  @ApiProperty()
  @IsString()
  signature: string;
}

// pm_getPaymasterStubData response
export class PaymasterStubDataResponse {
  @ApiProperty({ description: 'Paymaster address' })
  paymaster: string;

  @ApiProperty({ description: 'Stub data for gas estimation' })
  paymasterData: string;

  @ApiPropertyOptional({ description: 'Paymaster verification gas limit' })
  paymasterVerificationGasLimit?: string;

  @ApiPropertyOptional({ description: 'Paymaster post-op gas limit' })
  paymasterPostOpGasLimit?: string;

  @ApiPropertyOptional({ description: 'Whether sponsorship is active' })
  isFinal?: boolean;
}

// pm_getPaymasterData response
export class PaymasterDataResponse {
  @ApiProperty({ description: 'Paymaster address' })
  paymaster: string;

  @ApiProperty({ description: 'Signed paymaster data' })
  paymasterData: string;
}

// Call data from wallet_sendCalls
export class SendCallsCallDto {
  @ApiProperty()
  @IsString()
  to: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  data?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  value?: string;
}
