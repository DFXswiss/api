import { ApiProperty } from '@nestjs/swagger';
import { FeeType } from '../../../supporting/payment/entities/fee.entity';

export class PartnerFeeDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  label: string;

  @ApiProperty({ enum: FeeType })
  type: FeeType;

  @ApiProperty()
  rate: number;

  @ApiProperty()
  fixed: number;
}
