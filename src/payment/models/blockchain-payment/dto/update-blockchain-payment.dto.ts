import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { BlockchainPaymentType } from '../blockchain-payment.entity';

export class UpdateBlockchainPaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BlockchainPaymentType)
  type: BlockchainPaymentType;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  command: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  tx: string;

  @IsOptional()
  asset: any;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  assetValue: number;
}
