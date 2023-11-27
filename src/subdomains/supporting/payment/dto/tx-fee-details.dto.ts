import { FeeDto } from './fee.dto';

export interface ExtendedFeeDto extends FeeDto {
  min: number;
  amount: number;
}

export interface TxFeeDetails {
  minVolume: number;
  fee: ExtendedFeeDto;
}
