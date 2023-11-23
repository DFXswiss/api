import { FeeDto } from './fee.dto';

export interface TxFeeDetails extends FeeDto {
  minFee: number;
  minVolume: number;
  feeAmount: number;
}
