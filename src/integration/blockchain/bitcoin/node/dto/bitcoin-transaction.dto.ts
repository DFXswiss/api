import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';

export interface BitcoinUTXO extends UTXO {
  prevoutAddresses: string[];
}

export interface BitcoinTransactionVin {
  txid: string;
  vout: number;
  prevout: {
    value: number;
    scriptPubKey: {
      address: string;
    };
  };
}

export interface BitcoinTransactionVout {
  value: number;
  n: number;
  scriptPubKey: {
    address: string;
  };
}

export interface BitcoinTransaction {
  txid: string;
  fee: number;
  blockhash: string;
  time: number;
  vin: BitcoinTransactionVin[];
  vout: BitcoinTransactionVout[];
}
