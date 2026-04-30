import { FeeSpec } from '../fee.dto';

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
    dfx: FeeSpec;
    partner: FeeSpec;
    bank: FeeSpec;
    network: number;
    networkStart: number;
  };
}
