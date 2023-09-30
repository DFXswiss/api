export interface TxSpec {
  minVolume: number;
  minFee: number;
}

export interface TxSpecExtended extends TxSpec {
  maxVolume?: number;
}
