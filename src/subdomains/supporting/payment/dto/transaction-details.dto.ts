import { TransactionError } from '../services/transaction-helper';

export interface TargetEstimation {
  sourceAmount: number;
  exchangeRate: number;
  rate: number;
  feeAmount: number;
  estimatedAmount: number;
}

export interface TransactionDetails extends TargetEstimation {
  minFee: number;
  minVolume: number;
  minFeeTarget: number;
  minVolumeTarget: number;
  maxVolume: number;
  maxVolumeTarget: number;
  fee: number;
  additionalFee: number;
  isValid: boolean;
  error?: TransactionError;
}
