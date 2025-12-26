import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';

export class GaslessSignatureDto {
  @ApiProperty({ description: 'Signature v component' })
  @IsNotEmpty()
  @IsInt()
  v: number;

  @ApiProperty({ description: 'Signature r component (hex string)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/)
  r: string;

  @ApiProperty({ description: 'Signature s component (hex string)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/)
  s: string;
}

export class GaslessDto {
  @ApiProperty({ description: 'User address (EOA with EIP-7702 delegation)' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  userAddress: string;

  @ApiProperty({ description: 'ERC-20 token address' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  tokenAddress: string;

  @ApiProperty({ description: 'Amount in wei (string for large numbers)' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({ description: 'Recipient address (DFX deposit)' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  recipient: string;

  @ApiProperty({ description: 'Signature deadline (unix timestamp)' })
  @IsNotEmpty()
  @IsInt()
  deadline: number;

  @ApiProperty({ type: GaslessSignatureDto, description: 'EIP-712 signature components' })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => GaslessSignatureDto)
  signature: GaslessSignatureDto;
}

export class PermitDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.signature)
  signature: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  signatureTransferContract: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  permittedAmount: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  executorAddress: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  nonce: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  deadline: string;
}

export class ConfirmDto {
  @ApiPropertyOptional({ type: PermitDto, description: 'Permit signature for backend-executed transfer' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PermitDto)
  permit?: PermitDto;

  @ApiPropertyOptional({ description: 'User-signed transaction hex for broadcast' })
  @IsOptional()
  @IsString()
  signedTxHex?: string;

  @ApiPropertyOptional({ type: GaslessDto, description: 'EIP-7702 gasless transfer (DFX pays gas)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GaslessDto)
  gasless?: GaslessDto;
}
