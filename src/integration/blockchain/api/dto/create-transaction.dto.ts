import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class CreateTransactionDto {
  @ApiProperty({ enum: Blockchain, description: 'Blockchain for the transaction' })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Sender wallet address' })
  @IsNotEmpty()
  @IsString()
  fromAddress: string;

  @ApiProperty({ description: 'Recipient wallet address' })
  @IsNotEmpty()
  @IsString()
  toAddress: string;

  @ApiProperty({ description: 'Amount to send' })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Asset ID for token transfers. Omit for native coin transfers.' })
  @IsOptional()
  @IsNumber()
  assetId?: number;
}

export class UnsignedTransactionDto {
  @ApiProperty({ description: 'Serialized unsigned transaction (base64 or hex encoded)' })
  rawTransaction: string;

  @ApiProperty({ description: 'Encoding of the raw transaction', enum: ['base64', 'hex'] })
  encoding: 'base64' | 'hex';

  @ApiPropertyOptional({ description: 'Recent blockhash (for Solana)' })
  recentBlockhash?: string;

  @ApiPropertyOptional({ description: 'Expiration (for Tron)' })
  expiration?: number;
}

export class BroadcastTransactionDto {
  @ApiProperty({ enum: Blockchain, description: 'Blockchain for the transaction' })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Signed transaction (base64 or hex encoded)' })
  @IsNotEmpty()
  @IsString()
  signedTransaction: string;
}

export class BroadcastResultDto {
  @ApiProperty({ description: 'Transaction hash' })
  txHash: string;
}
