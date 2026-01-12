import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Eip7702AuthorizationDto } from './gasless-transfer.dto';

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

  @ApiPropertyOptional({ description: 'Transaction hash from wallet_sendCalls (EIP-5792 gasless transfer)' })
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiPropertyOptional({ description: 'EIP-7702 authorization signed by user', type: Eip7702AuthorizationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => Eip7702AuthorizationDto)
  authorization?: Eip7702AuthorizationDto;
}
