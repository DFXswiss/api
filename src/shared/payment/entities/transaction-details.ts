export interface TargetEstimation {
  price: number;
  fee: number;
  amount: number;
}

export interface TransactionDetails extends TargetEstimation {
  minFee: number;
  minVolume: number;
}
