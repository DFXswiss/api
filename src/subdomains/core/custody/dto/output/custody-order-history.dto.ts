import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustodyOrderType } from '../../enums/custody';

export enum CustodyOrderHistoryStatus {
  WAITING_FOR_PAYMENT = 'WaitingForPayment',
  CHECK_PENDING = 'CheckPending',
  PROCESSING = 'Processing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

export class CustodyOrderHistoryDto {
  @ApiProperty({ enum: CustodyOrderType })
  type: CustodyOrderType;

  @ApiProperty({ enum: CustodyOrderHistoryStatus })
  status: CustodyOrderHistoryStatus;

  @ApiProperty()
  created: Date;

  @ApiPropertyOptional({ description: 'Valuta timestamp, set once the order is completed' })
  completedAt?: Date;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;
}
