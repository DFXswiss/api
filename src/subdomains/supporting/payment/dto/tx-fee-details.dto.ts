import { FeeDto } from './fee.dto';

export interface TxFeeDetails {
  minFee: number;
  minVolume: number;
  fee: FeeDto;
  feeAmount: number;
}
