import { Fee } from '../entities/fee.entity';

export class FeeDto {
  rate: number; // final fee rate
  fixed: number; // final fixed fee
  blockchain: number; // final blockchain fee
  min?: number;
  total?: number;
}

export class InternalFeeDto extends FeeDto {
  fees: Fee[];
  payoutRefBonus: boolean;
}
