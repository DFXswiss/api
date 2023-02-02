import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class EvmCoinTransactionDto {
  @IsNotEmpty()
  @IsString()
  fromAddress: string;

  @IsNotEmpty()
  @IsString()
  toAddress: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsNumber()
  feeLimit?: number;

  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}
