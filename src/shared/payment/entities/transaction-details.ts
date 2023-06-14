export interface TargetEstimation {
  exchangeRate: number;
  feeAmount: number;
  estimatedAmount: number;
}

export interface TransactionDetails extends TargetEstimation {
  minFee: number;
  minVolume: number;
  minFeeTarget: number;
  minVolumeTarget: number;
}
