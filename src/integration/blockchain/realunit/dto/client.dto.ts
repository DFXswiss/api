export interface HistoricalBalance {
  balance: string;
  timestamp: string;
}

export interface Account {
  address: string;
  addressType: string;
  balance: string;
  lastUpdated: string;
  historicalBalances: {
    items: HistoricalBalance[];
  };
}

export interface AccountSummaryClientResponse {
  account: Account;
}

export interface PageInfo {
  endCursor: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string;
}

export interface HolderClientResponse {
  address: string;
  balance: string;
}

export interface ChangeTotalShares {
  total: string;
  timestamp: string;
  txHash: string;
}

export interface TotalSupply {
  value: string;
  timestamp: string;
}

export interface HoldersClientResponse {
  changeTotalShares: {
    items: ChangeTotalShares[];
  };
  totalSupplys: {
    items: TotalSupply[];
  };
  accounts: {
    items: HolderClientResponse[];
    pageInfo: PageInfo;
    totalCount: number;
  };
}

export enum HistoryEventType {
  TRANSFER = 'transfer',
  APPROVAL = 'approval',
  TOKEN_DECLARED_INVALID = 'tokensDeclaredInvalid',
  ADDRESS_TYPE_UPDATE = 'addressTypeUpdate',
}

export interface AddressTypeUpdate {
  addressType: string;
}

export interface Approval {
  spender: string;
  value: string;
}

export interface TokensDeclaredInvalid {
  amount: string;
  message: string;
}

export interface Transfer {
  from: string;
  to: string;
  value: string;
}

export interface HistoryEvent {
  timestamp: string;
  eventType: HistoryEventType;
  txHash: string;
  addressTypeUpdate?: AddressTypeUpdate;
  approval?: Approval;
  tokensDeclaredInvalid?: TokensDeclaredInvalid;
  transfer?: Transfer;
}

export interface AccountHistoryClientResponse {
  account: {
    address: string;
    addressType: string;
    history: {
      items: HistoryEvent[];
      totalCount: number;
      pageInfo: PageInfo;
    };
  };
}
