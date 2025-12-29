export interface UTXO {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
}

export interface BitcoinUTXO extends UTXO {
  prevoutAddresses: string[];
  isUnconfirmed?: boolean;
  feeRate?: number;
  isNextBlockCandidate?: boolean;
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
