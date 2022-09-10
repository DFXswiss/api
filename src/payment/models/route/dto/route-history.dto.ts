import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AmlCheck } from '../../buy-crypto/enums/aml-check.enum';

export enum HistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

export class RouteHistoryDto {
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

  @ApiProperty()
  date: Date;

  @ApiProperty()
  amlCheck: AmlCheck;

  @ApiProperty()
  isComplete: boolean;
}

export class TypedRouteHistoryDto extends RouteHistoryDto {
  @ApiProperty({ enum: HistoryTransactionType })
  type: HistoryTransactionType;
}
