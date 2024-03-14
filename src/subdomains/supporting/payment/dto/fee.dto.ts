import { ApiProperty } from '@nestjs/swagger';
import { Fee } from '../entities/fee.entity';

export class BaseFeeDto {
  @ApiProperty({ description: 'Fee rate' })
  rate: number; // final fee rate

  @ApiProperty({ description: 'Fixed fee amount' })
  fixed: number; // final fixed fee

  @ApiProperty({ description: 'Blockchain fee amount' })
  blockchain: number; // final blockchain fee
}

export class FeeDto extends BaseFeeDto {
  @ApiProperty({ description: 'Min fee amount' })
  min: number;

  @ApiProperty({ description: 'Total fee amount' })
  total: number;
}

export class InternalFeeDto extends BaseFeeDto {
  fees: Fee[];
  payoutRefBonus: boolean;
}
