export interface TxMinSpec {
  minVolume: number;
  minFee: number;
}

export interface TxSpec {
  volume: {
    min: number;
    max: number;
  };
  fee: {
    min: number;
    fixed: number;
    network: number;
    networkStart: number;
  };
}
