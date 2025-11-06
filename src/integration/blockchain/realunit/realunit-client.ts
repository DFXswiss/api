import { request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { AccountHistoryClientResponse, AccountSummaryClientResponse, HoldersClientResponse } from './dto/client.dto';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery } from './utils/queries';

export class RealunitClient {
  ponderUrl: string;
  constructor() {
    this.ponderUrl = GetConfig().blockchain.realunit.graphUrl;
  }

  async getAccountSummary(address: string): Promise<AccountSummaryClientResponse> {
    const accountSummaryQuery = getAccountSummaryQuery(address);
    return request<AccountSummaryClientResponse>(this.ponderUrl, accountSummaryQuery);
  }

  async getHolders(first?: number, after?: string): Promise<HoldersClientResponse> {
    const holdersQuery = getHoldersQuery(first, after);
    return request<HoldersClientResponse>(this.ponderUrl, holdersQuery);
  }

  async getAccountHistory(address: string, first?: number, after?: string): Promise<AccountHistoryClientResponse> {
    const accountHistoryQuery = getAccountHistoryQuery(address, first, after);
    return request<AccountHistoryClientResponse>(this.ponderUrl, accountHistoryQuery);
  }
}
