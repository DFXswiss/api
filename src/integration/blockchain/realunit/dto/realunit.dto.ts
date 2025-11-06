import {
  ChangeTotalShares,
  HistoricalBalance,
  HolderClientResponse,
  HistoryEvent,
  PageInfo,
  TotalSupply,
} from './client.dto';

export class AccountSummaryDto {
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

export class HoldersDto {
  totalShares: ChangeTotalShares | null;
  totalSupply: TotalSupply | null;
  holders: HolderDto[];
  pageInfo: PageInfo;
  totalCount: number;
}

export class AccountHistoryDto {
  address: string;
  addressType: string;
  history: HistoryEvent[];
  totalCount: number;
  pageInfo: PageInfo;
}
