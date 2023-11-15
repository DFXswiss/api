import { Fee } from '../entities/fee.entity';

export class FeeDto {
  fees: Fee[];
  rate: number;
  fixed: number;
  payoutRefBonus: boolean;
}
