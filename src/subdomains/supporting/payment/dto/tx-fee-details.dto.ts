import { FeeDto, InternalFeeDto } from './fee.dto';

export interface TxFeeDetails {
  minVolume: number;
  fee: InternalFeeDto & FeeDto;
}
