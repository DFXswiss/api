import {
  ChangeTotalShares,
  HistoricalBalance,
  HistoryEvent,
  HolderClientResponse,
  PageInfo,
  TotalSupply,
} from './client.dto';

export class AccountSummaryResponse {
  address: string;
  addressType: string;
  balance: string;
  lastUpdated: string;
  historicalBalances: HistoricalBalance[];
}

export class HolderDto implements HolderClientResponse {
  address: string;
  balance: string;
  percentage: number;
}

export class HoldersResponse {
  totalShares: ChangeTotalShares | null;
  totalSupply: TotalSupply | null;
  holders: HolderDto[];
  pageInfo: PageInfo;
  totalCount: number;
}

export class AccountHistoryResponse {
  address: string;
  addressType: string;
  history: HistoryEvent[];
  totalCount: number;
  pageInfo: PageInfo;
}
