import { FeeDto } from './fee.dto';

export interface ExtendedFeeDto extends FeeDto {
  min: number;
  total: number;
}

export interface TxFeeDetails {
  minVolume: number;
  fee: ExtendedFeeDto;
}
