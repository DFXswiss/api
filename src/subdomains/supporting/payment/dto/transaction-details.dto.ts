import { BaseFeeDto, FeeDto } from './fee.dto';
import { TransactionError } from './transaction-error.enum';

export interface TargetEstimation {
  sourceAmount: number;
  exchangeRate: number;
  rate: number;
  feeAmount: number;
  estimatedAmount: number;
  exactPrice: boolean;
}

export interface TransactionDetails extends TargetEstimation {
  minFee: number;
  minVolume: number;
  minFeeTarget: number;
  minVolumeTarget: number;
  maxVolume: number;
  maxVolumeTarget: number;
  fee: BaseFeeDto;
  feeSource: FeeDto;
  feeTarget: FeeDto;
  isValid: boolean;
  error?: TransactionError;
}
