import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';

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
}
