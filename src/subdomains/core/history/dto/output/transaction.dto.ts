import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TransactionState, TransactionType } from '../transaction/transaction.dto';

export class TransactionDto {
  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ enum: TransactionState })
  state: TransactionState;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiPropertyOptional()
  feeAmount?: number;

  @ApiPropertyOptional()
  feeAsset?: string;

  @ApiPropertyOptional()
  txId?: string;

  @ApiPropertyOptional()
  txUrl?: string;

  @ApiProperty({ type: Date })
  date: Date;
}
