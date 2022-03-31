import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from './http.service';

export interface OceanTransaction {
  owner: string;
  txid: string;
  txn: number;
  type: string;
  amounts: string[];
  block: {
    height: number;
    hash: string;
    time: number;
  };
}

export enum OceanTxType {
  POOL_SWAP = 'PoolSwap',
  ADD_POOL_LIQUIDITY = 'AddPoolLiquidity',
  REMOVE_POOL_LIQUIDITY = 'RemovePoolLiquidity',
  ACCOUNT_TO_ACCOUNT = 'AccountToAccount',
  ANY_ACCOUNTS_TO_ACCOUNTS = 'AnyAccountsToAccounts',
  TAKE_LOAN = 'TakeLoan',
  PAYBACK_LOAN = 'PaybackLoan',
  DEPOSIT_TO_VAULT = 'DepositToVault',
  WITHDRAW_FROM_VAULT = 'WithdrawFromVault',
}

@Injectable()
export class OceanService {
  private readonly baseUrl = 'https://ocean.defichain.com/v0/mainnet/';

  constructor(private readonly http: HttpService) {}

  async getTransactions(
    address: string,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
    timeout = 15000,
  ): Promise<OceanTransaction[]> {
    const url = `${this.baseUrl}/${address}/history`;

    try {
      const rewards = await this.http.get<OceanTransaction[]>(url, { timeout: timeout, tryCount: 3 });

      return rewards.filter((item) => {
        return (
          new Date(item.block.time).getTime() >= dateFrom.getTime() &&
          new Date(item.block.time).getTime() <= dateTo.getTime()
        );
      });
    } catch {
      throw new ServiceUnavailableException(`DFI.tax timeout (${timeout}ms)`);
    }
  }
}
