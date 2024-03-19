export interface TxSpec {
  minVolume: number;
  minFee: number;
}

export interface TxSpecExtended {
  volume: {
    min: number;
    max?: number;
  };
  fee: {
    min: number;
    rate?: number;
    fixed?: number;
    dfx?: number;
    blockchain?: number;
    total?: number;
  };
}
