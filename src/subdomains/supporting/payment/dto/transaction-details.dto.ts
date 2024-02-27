import { FeeDto } from './fee.dto';
import { TransactionError } from './transaction.dto';

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
  fee: FeeDto;
  isValid: boolean;
  error?: TransactionError;
}
