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
    partnerFixed: number;
    bankFixed: number;
    network: number;
    networkStart: number;
  };
}
