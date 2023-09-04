export interface IknaAddressNeighborInfo {
  next_page: string;
  neighbors: IknaAddressNeighbor[];
}

export interface IknaAddressNeighbor {
  address: {
    actors?: { id: string; label: string }[];
    address: string;
    balance: IknaFiatValues;
    currency: string;
    entity: number;
    first_tx: {
      tx_hash: string;
      height: number;
      timestamp: number;
    };
    in_degree: number;
    is_contract?: boolean;
    last_tx: {
      tx_hash: string;
      height: number;
      timestamp: number;
    };
    no_incoming_txs: number;
    no_outgoing_txs: number;
    out_degree: number;
    status: IknaStatus;
    token_balances?: IknaBalance;
    total_received: IknaFiatValues;
    total_spent: IknaFiatValues;
    total_tokens_received?: IknaBalance;
    total_tokens_spent: IknaBalance;
  };
  labels?: string[];
  no_txs: number;
  token_values?: IknaBalance;
  value: IknaFiatValues;
}

interface IknaBalance {
  [key: string]: IknaFiatValues;
}

interface IknaFiatValues {
  fiat_values: { code: string; value: number };
  value: number;
}

enum IknaStatus {
  CLEAN = 'clean',
  DIRTY = 'dirty',
  NEW = 'new',
}
