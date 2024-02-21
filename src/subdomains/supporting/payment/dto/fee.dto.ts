import { Fee } from '../entities/fee.entity';

export class FeeDto {
  fees: Fee[];
  rate: number; // final fee rate
  fixed: number; // final fixed fee
  blockchain: number; // final blockchain fee
  payoutRefBonus: boolean;
}
