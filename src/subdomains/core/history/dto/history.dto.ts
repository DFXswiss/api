import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';

export enum HistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

export class HistoryDto {
  @ApiProperty()
  inputAmount: number;

  @ApiProperty()
  inputAsset: string;

  @ApiPropertyOptional()
  outputAmount: number;

  @ApiPropertyOptional()
  outputAsset: string;

  @ApiPropertyOptional()
  txId: string;

  @ApiPropertyOptional()
  txUrl: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  amlCheck: AmlCheck;

  @ApiProperty()
  isComplete: boolean;
}

export class TypedHistoryDto extends HistoryDto {
  @ApiProperty({ enum: HistoryTransactionType })
  type: HistoryTransactionType;
}
