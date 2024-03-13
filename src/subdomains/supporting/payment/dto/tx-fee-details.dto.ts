import { FeeDto } from './fee.dto';

export interface TxFeeDetails {
  minVolume: number;
  fee: FeeDto;
}
