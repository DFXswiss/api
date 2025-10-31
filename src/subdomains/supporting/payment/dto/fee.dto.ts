import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Fee } from '../entities/fee.entity';

export class BaseFeeDto {
  @ApiProperty({ description: 'Fee rate' })
  rate: number; // final fee rate

  @ApiProperty({ description: 'Fixed fee amount' })
  fixed: number; // final fixed fee

  @ApiProperty({ description: 'Network fee amount' })
  network: number; // final network fee
}

export class FeeDto extends BaseFeeDto {
  @ApiProperty({ description: 'Minimum fee amount' })
  min: number;

  @ApiProperty({ description: 'DFX fee amount' })
  dfx: number;

  @ApiProperty({ description: 'Platform fee amount' })
  platform: number;

  @ApiProperty({ description: 'Bank fee amount' })
  bank: number; // final bank fee addition

  @ApiProperty({ description: 'Total fee amount (DFX + bank + network fee)' })
  total: number;

  @ApiPropertyOptional({ description: 'Network start fee' })
  networkStart?: number;
}

export class InternalBaseFeeDto extends BaseFeeDto {
  fees: Fee[];
  bankRate: number; // bank fee rate
  bankFixed: number; // bank fixed fee
  partnerRate: number; // partner fee rate
  partnerFixed: number; // partner fixed rate
}

export class InternalFeeDto extends InternalBaseFeeDto {
  payoutRefBonus: boolean;
}

export class InternalChargebackFeeDto extends InternalBaseFeeDto {}
